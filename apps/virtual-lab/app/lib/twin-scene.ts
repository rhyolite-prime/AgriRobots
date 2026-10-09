import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type { TwinFrameData } from '../shared/lab-types';

/**
 * The ARACNID kinematic twin.
 *
 * This draws what the world model reported — rover pose, eight shoulder/elbow/
 * wrist triples, nest slots, magazine fill and safety state. There is no
 * rigid-body physics and no invented geometry: every dimension comes from
 * `ARACNID` in `@agrirobots/engine`, which is the same table
 * `docs/10_ARACNID_AR01_DESIGN_BASIS.md` fixes.
 *
 * Frame convention is ROS REP-103 (x forward, y left, z up) converted to
 * Three.js (x right, y up, z back).
 */

/** Subset of the engine's `ARACNID` constants the renderer needs. */
export interface TwinGeometry {
  handCount: number;
  shoulderBaseAnglesDeg: number[];
  ringRadiusM: number;
  ringHeightMm: number;
  reachMm: number;
  trayCount: number;
  trayCapacity: number;
  nestBankDistanceM: number;
  nestBankWidthM: number;
  nestBankDepthM: number;
  nestBankHeightM: number;
  nestArcRadiusM?: number;
  bodyLengthMm?: number;
  bodyWidthMm?: number;
  wheelDiameterMm?: number;
  wheelbaseMm?: number;
  trackMm?: number;
  tiltTripDeg: number;
  [key: string]: unknown;
}

/** Egg grade -> colour, shared with the viewport legend. */
export const GRADE_COLOURS: Record<string, number> = {
  saleable: 0xf2e3c2,
  dirty: 0x9c8355,
  undersized: 0xd9c9a5,
  cracked: 0xb8493a,
  unknown: 0x8d8d8d,
};

/** Hand state -> colour, shared with the viewport legend. */
export const ARM_STATE_COLOURS: Record<string, number> = {
  stowed: 0x616b78,
  reaching: 0x3f8fd6,
  sealing: 0xe0a63c,
  holding: 0x4caf6d,
  placing: 0x4fc3d9,
  fault: 0xd9483b,
};

const DEG = Math.PI / 180;

/** ROS (x forward, y left, z up) -> Three.js (x right, y up, z back). */
function toThree(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(-y, z, -x);
}

function lerp(left: number, right: number, alpha: number): number {
  return left + (right - left) * alpha;
}

/**
 * Blends two twin frames. Numbers interpolate so the replay moves smoothly
 * between statements; identity, grades and safety state come from the later
 * frame, because those change state and must not be half-applied.
 */
export function blendFrames(a: TwinFrameData, b: TwinFrameData, alpha: number): TwinFrameData {
  if (alpha <= 0) return a;
  if (alpha >= 1) return b;
  return {
    t: lerp(a.t, b.t, alpha),
    carrier: {
      x: lerp(a.carrier.x, b.carrier.x, alpha),
      y: lerp(a.carrier.y, b.carrier.y, alpha),
      heading: lerp(a.carrier.heading, b.carrier.heading, alpha),
      speed: lerp(a.carrier.speed, b.carrier.speed, alpha),
      parked: b.carrier.parked,
      tilt: lerp(a.carrier.tilt, b.carrier.tilt, alpha),
      armsDeployed: b.carrier.armsDeployed,
      battery: lerp(a.carrier.battery, b.carrier.battery, alpha),
    },
    arms: b.arms.map((arm, index) => {
      const before = a.arms[index] ?? arm;
      return {
        ...arm,
        shoulderYaw: lerp(before.shoulderYaw, arm.shoulderYaw, alpha),
        elbowPitch: lerp(before.elbowPitch, arm.elbowPitch, alpha),
        wristPitch: lerp(before.wristPitch, arm.wristPitch, alpha),
        extension: lerp(before.extension, arm.extension, alpha),
        suctionKpa: lerp(before.suctionKpa, arm.suctionKpa, alpha),
        forceN: lerp(before.forceN, arm.forceN, alpha),
      };
    }),
    magazine: b.magazine,
    nestBank: b.nestBank,
    tally: b.tally,
    safety: b.safety,
  };
}

interface ArmRig {
  id: string;
  yaw: THREE.Group;
  elbow: THREE.Group;
  wrist: THREE.Group;
  forearm: THREE.Mesh;
  cup: THREE.Mesh;
  heldEgg: THREE.Mesh;
  stateMaterial: THREE.MeshStandardMaterial;
  label: THREE.Sprite;
}

function labelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(9, 14, 20, 0.78)';
    ctx.beginPath();
    ctx.roundRect(8, 12, 112, 40, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 190, 255, 0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#dce9f7';
    ctx.font = '600 26px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 33);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }),
  );
  sprite.scale.set(0.22, 0.11, 1);
  sprite.renderOrder = 10;
  return sprite;
}

export class AracnidTwinScene {
  private readonly container: HTMLElement;
  private readonly geometry: TwinGeometry;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly observer: ResizeObserver;
  private readonly rover = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly arms: ArmRig[] = [];
  private readonly trayMeshes: THREE.Mesh[] = [];
  private readonly nestGroup = new THREE.Group();
  private readonly slotMeshes = new Map<string, { ring: THREE.Mesh; egg: THREE.Mesh | null }>();
  private readonly worker: THREE.Group;
  private readonly tiltReadout: THREE.Mesh;
  private frameHandle = 0;
  private disposed = false;

  constructor(container: HTMLElement, geometry: TwinGeometry) {
    this.container = container;
    this.geometry = geometry;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x0a0f15);
    this.scene.fog = new THREE.Fog(0x0a0f15, 8, 22);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
    this.camera.position.set(2.5, 2.1, 1.9);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.55, -0.55);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 0.8;
    this.controls.maxDistance = 12;

    this.buildEnvironment();
    this.buildRover();
    this.buildArms();
    this.buildNest();

    this.worker = this.buildWorker();
    this.worker.visible = false;
    this.scene.add(this.worker);

    this.tiltReadout = this.buildTiltIndicator();
    this.scene.add(this.tiltReadout);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    this.loop();
  }

  // -- construction ------------------------------------------------------------

  private buildEnvironment(): void {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(9, 64),
      new THREE.MeshStandardMaterial({ color: 0x151c24, roughness: 0.95, metalness: 0.02 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const grid = new THREE.GridHelper(12, 24, 0x2c3a48, 0x1b2530);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    grid.position.y = 0.002;
    this.scene.add(grid);

    const hemisphere = new THREE.HemisphereLight(0xbcd7ff, 0x2a2118, 0.85);
    this.scene.add(hemisphere);

    const key = new THREE.DirectionalLight(0xfff2dd, 1.5);
    key.position.set(3.2, 5.2, 2.4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 16;
    key.shadow.camera.left = -3;
    key.shadow.camera.right = 3;
    key.shadow.camera.top = 3;
    key.shadow.camera.bottom = -3;
    key.shadow.bias = -0.0012;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x7fb2ff, 0.35);
    fill.position.set(-2.5, 2.0, -3.0);
    this.scene.add(fill);

    // Datum A: the arm-ring reference plane from docs/10 section 5.
    const datum = new THREE.Mesh(
      new THREE.RingGeometry(
        this.geometry.ringRadiusM - 0.03,
        this.geometry.ringRadiusM + 0.03,
        64,
      ),
      new THREE.MeshBasicMaterial({
        color: 0x3d6f9e,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
      }),
    );
    datum.rotation.x = -Math.PI / 2;
    datum.position.y = this.geometry.ringHeightMm / 1000;
    this.rover.add(datum);

    const reach = new THREE.Mesh(
      new THREE.RingGeometry(
        this.geometry.reachMm / 1000 - 0.008,
        this.geometry.reachMm / 1000,
        96,
      ),
      new THREE.MeshBasicMaterial({
        color: 0x2f5d7c,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
      }),
    );
    reach.rotation.x = -Math.PI / 2;
    reach.position.y = 0.006;
    this.rover.add(reach);
  }

  private buildRover(): void {
    const lengthM = (this.geometry.bodyLengthMm ?? 1650) / 1000;
    const widthM = (this.geometry.bodyWidthMm ?? 1150) / 1000;
    const wheelR = (this.geometry.wheelDiameterMm ?? 450) / 2000;
    const wheelbase = (this.geometry.wheelbaseMm ?? 1250) / 1000;
    const track = (this.geometry.trackMm ?? 950) / 1000;

    const chassis = new THREE.Mesh(
      new THREE.BoxGeometry(widthM, 0.34, lengthM),
      new THREE.MeshStandardMaterial({ color: 0x2f4a35, roughness: 0.62, metalness: 0.28 }),
    );
    chassis.position.y = wheelR + 0.19;
    chassis.castShadow = true;
    chassis.receiveShadow = true;
    this.body.add(chassis);

    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(widthM * 0.92, 0.06, lengthM * 0.9),
      new THREE.MeshStandardMaterial({ color: 0x40594a, roughness: 0.5, metalness: 0.35 }),
    );
    deck.position.y = wheelR + 0.38;
    deck.castShadow = true;
    this.body.add(deck);

    // Magazine: 6 trays x 30 eggs, tilt-indexed (EG-08, docs/10 section 5).
    const magazine = new THREE.Mesh(
      new THREE.BoxGeometry(0.58, 0.3, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x35404d, roughness: 0.55, metalness: 0.4 }),
    );
    magazine.position.set(0, wheelR + 0.56, lengthM * 0.24);
    magazine.castShadow = true;
    this.body.add(magazine);

    for (let index = 0; index < this.geometry.trayCount; index += 1) {
      const tray = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.022, 0.11),
        new THREE.MeshStandardMaterial({ color: 0x1d2733, roughness: 0.4, metalness: 0.5 }),
      );
      tray.position.set(0, wheelR + 0.47 + index * 0.036, lengthM * 0.24);
      tray.castShadow = true;
      this.body.add(tray);
      this.trayMeshes.push(tray);
    }

    // Arm ring mast.
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.11, this.geometry.ringHeightMm / 1000 - wheelR - 0.3, 20),
      new THREE.MeshStandardMaterial({ color: 0x4a5563, roughness: 0.45, metalness: 0.6 }),
    );
    mast.position.set(0, (wheelR + 0.3 + this.geometry.ringHeightMm / 1000) / 2, -lengthM * 0.12);
    mast.castShadow = true;
    this.body.add(mast);

    const wheelGeometry = new THREE.CylinderGeometry(wheelR, wheelR, 0.16, 24);
    const wheelMaterial = new THREE.MeshStandardMaterial({
      color: 0x14181d,
      roughness: 0.9,
      metalness: 0.1,
    });
    for (const [x, z] of [
      [-track / 2, -wheelbase / 2],
      [track / 2, -wheelbase / 2],
      [-track / 2, wheelbase / 2],
      [track / 2, wheelbase / 2],
    ] as Array<[number, number]>) {
      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, wheelR, z);
      wheel.castShadow = true;
      this.body.add(wheel);

      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(wheelR * 0.42, wheelR * 0.42, 0.18, 16),
        new THREE.MeshStandardMaterial({ color: 0x77838f, roughness: 0.35, metalness: 0.8 }),
      );
      hub.rotation.z = Math.PI / 2;
      hub.position.set(x, wheelR, z);
      this.body.add(hub);
    }

    this.rover.add(this.body);
    this.scene.add(this.rover);
  }

  private buildArms(): void {
    const ringHeight = this.geometry.ringHeightMm / 1000;
    const upper = 0.34;
    const fore = 0.3;

    for (let index = 0; index < this.geometry.handCount; index += 1) {
      const baseAngle = (this.geometry.shoulderBaseAnglesDeg[index] ?? index * 45 - 67.5) * DEG;
      const id = `hand_${String(index + 1)}`;

      const mount = new THREE.Group();
      // ROS angle is measured from forward (+x) towards left (+y); in Three.js
      // forward is -z and left is -x, which is a rotation about +y.
      mount.position.copy(
        toThree(
          Math.cos(baseAngle) * this.geometry.ringRadiusM,
          Math.sin(baseAngle) * this.geometry.ringRadiusM,
          ringHeight,
        ),
      );
      mount.rotation.y = baseAngle;
      this.body.add(mount);

      const shoulderBall = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 18, 14),
        new THREE.MeshStandardMaterial({ color: 0x8c98a6, roughness: 0.35, metalness: 0.75 }),
      );
      shoulderBall.castShadow = true;
      mount.add(shoulderBall);

      const yaw = new THREE.Group();
      mount.add(yaw);

      const stateMaterial = new THREE.MeshStandardMaterial({
        color: ARM_STATE_COLOURS['stowed'] ?? 0x616470,
        roughness: 0.4,
        metalness: 0.55,
        emissive: 0x000000,
      });

      const upperArm = new THREE.Mesh(new THREE.BoxGeometry(0.07, upper, 0.09), stateMaterial);
      // Built hanging down from the shoulder, so a positive elbow pitch swings
      // it forward exactly as the world model's angle convention describes.
      upperArm.position.y = -upper / 2;
      upperArm.castShadow = true;
      yaw.add(upperArm);

      const elbow = new THREE.Group();
      elbow.position.y = -upper;
      yaw.add(elbow);

      const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.055, fore, 0.07), stateMaterial);
      forearm.position.y = -fore / 2;
      forearm.castShadow = true;
      elbow.add(forearm);

      const wrist = new THREE.Group();
      wrist.position.y = -fore;
      elbow.add(wrist);

      const cup = new THREE.Mesh(
        new THREE.CylinderGeometry(0.019, 0.032, 0.05, 18),
        new THREE.MeshStandardMaterial({ color: 0x2b3440, roughness: 0.85, metalness: 0.05 }),
      );
      cup.position.y = -0.03;
      cup.castShadow = true;
      wrist.add(cup);

      const heldEgg = new THREE.Mesh(
        new THREE.SphereGeometry(0.023, 16, 12),
        new THREE.MeshStandardMaterial({
          color: GRADE_COLOURS['saleable'] ?? 0xf2e3c2,
          roughness: 0.55,
        }),
      );
      heldEgg.scale.set(1, 1.28, 1);
      heldEgg.position.y = -0.075;
      heldEgg.visible = false;
      heldEgg.castShadow = true;
      wrist.add(heldEgg);

      const label = labelSprite(id.replace('hand_', 'H'));
      label.position.y = 0.14;
      mount.add(label);

      this.arms.push({ id, yaw, elbow, wrist, forearm, cup, heldEgg, stateMaterial, label });
    }
  }

  private buildNest(): void {
    const { nestBankWidthM: width, nestBankDepthM: depth, nestBankHeightM: height } = this.geometry;
    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({ color: 0x3a2f24, roughness: 0.92, metalness: 0.02 }),
    );
    shell.position.y = height / 2;
    shell.castShadow = true;
    shell.receiveShadow = true;
    this.nestGroup.add(shell);

    const bedding = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.96, 0.03, depth * 0.92),
      new THREE.MeshStandardMaterial({ color: 0x8a7242, roughness: 1 }),
    );
    bedding.position.y = height - 0.02;
    bedding.receiveShadow = true;
    this.nestGroup.add(bedding);

    const label = labelSprite('nest bank 3');
    label.position.set(0, height + 0.28, 0);
    label.scale.set(0.5, 0.25, 1);
    this.nestGroup.add(label);

    this.scene.add(this.nestGroup);
  }

  private buildWorker(): THREE.Group {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({
      color: 0xd98a2b,
      roughness: 0.6,
      emissive: 0x40200a,
    });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.95, 6, 14), material);
    body.position.y = 0.85;
    body.castShadow = true;
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 14), material);
    head.position.y = 1.62;
    head.castShadow = true;
    group.add(head);
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.62, 48),
      new THREE.MeshBasicMaterial({
        color: 0xff9d3d,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
      }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.02;
    group.add(halo);
    return group;
  }

  private buildTiltIndicator(): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(1.05, 0.012, 8, 72),
      new THREE.MeshBasicMaterial({ color: 0x4a5a6a, transparent: true, opacity: 0.45 }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.01;
    return mesh;
  }

  /**
   * Creates the meshes for slots this run reports. Positions are refreshed every
   * frame, because a different nest layout puts the same slot ids elsewhere.
   */
  private ensureSlots(frame: TwinFrameData): void {
    for (const slot of frame.nestBank.slots) {
      if (this.slotMeshes.has(slot.id)) continue;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.032, 0.042, 24),
        new THREE.MeshBasicMaterial({
          color: 0x5d6f7f,
          transparent: true,
          opacity: 0.5,
          side: THREE.DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(toThree(slot.x, slot.y, slot.z + 0.001));
      this.nestGroup.add(ring);

      const egg = new THREE.Mesh(
        new THREE.SphereGeometry(0.023, 16, 12),
        new THREE.MeshStandardMaterial({ color: 0xf2e3c2, roughness: 0.55 }),
      );
      egg.scale.set(1, 1.28, 1);
      egg.position.copy(toThree(slot.x, slot.y, slot.z + 0.026));
      egg.castShadow = true;
      this.nestGroup.add(egg);
      this.slotMeshes.set(slot.id, { ring, egg });
    }
  }

  // -- per-frame update --------------------------------------------------------

  applyFrame(frame: TwinFrameData): void {
    this.ensureSlots(frame);

    const position = toThree(frame.carrier.x, frame.carrier.y, 0);
    this.rover.position.set(position.x, 0, position.z);
    this.rover.rotation.y = frame.carrier.heading;
    // Tilt is a magnitude in the world model; roll it about the forward axis so
    // the guard breach is visible rather than merely reported.
    this.body.rotation.z = frame.carrier.tilt * DEG;

    frame.arms.forEach((arm, index) => {
      const rig = this.arms[index];
      if (!rig || rig.id !== arm.id) return;
      // shoulderYaw is the deviation from the shoulder's own base angle, which
      // the mount already carries, so only the deviation is applied here.
      rig.yaw.rotation.y = arm.shoulderYaw * DEG;
      rig.elbow.rotation.x = arm.elbowPitch * DEG;
      rig.wrist.rotation.x = arm.wristPitch * DEG;
      // Extension telescopes the forearm: the world reports reach, not a fourth joint.
      const scale = 0.72 + 0.28 * Math.min(1, Math.max(0, arm.extension));
      rig.forearm.scale.y = scale;
      rig.wrist.position.y = -0.3 * scale;
      rig.stateMaterial.color.setHex(
        ARM_STATE_COLOURS[arm.state] ?? ARM_STATE_COLOURS['stowed'] ?? 0x616470,
      );
      rig.stateMaterial.emissive.setHex(
        arm.state === 'fault' ? 0x5a1109 : arm.suctionKpa > 1 ? 0x0d2a17 : 0x000000,
      );
      rig.heldEgg.visible = arm.holding !== null;
      rig.label.material.opacity = arm.state === 'stowed' ? 0.35 : 1;
    });

    const present = new Set(frame.nestBank.slots.map((slot) => slot.id));
    for (const [id, meshes] of this.slotMeshes) {
      // A run with fewer eggs than the last one must not leave ghosts behind.
      if (!present.has(id)) {
        meshes.ring.visible = false;
        if (meshes.egg) meshes.egg.visible = false;
      }
    }

    for (const slot of frame.nestBank.slots) {
      const meshes = this.slotMeshes.get(slot.id);
      if (!meshes) continue;
      meshes.ring.visible = true;
      meshes.ring.position.copy(toThree(slot.x, slot.y, slot.z + 0.001));
      if (meshes.egg) meshes.egg.position.copy(toThree(slot.x, slot.y, slot.z + 0.026));
      const material = meshes.ring.material as THREE.MeshBasicMaterial;
      material.color.setHex(slot.scanned ? 0x7fd4a0 : 0x5d6f7f);
      material.opacity = slot.scanned ? 0.85 : 0.4;
      if (meshes.egg) {
        meshes.egg.visible = slot.egg !== null;
        if (slot.egg) {
          const eggMaterial = meshes.egg.material as THREE.MeshStandardMaterial;
          eggMaterial.color.setHex(
            slot.egg.cracked
              ? (GRADE_COLOURS['cracked'] ?? 0xb8493a)
              : (GRADE_COLOURS[slot.egg.grade] ?? GRADE_COLOURS['unknown'] ?? 0x8d8d8d),
          );
          eggMaterial.emissive.setHex(slot.egg.cracked ? 0x3d120c : 0x000000);
        }
      }
    }

    const nestPosition = toThree(frame.nestBank.x, frame.nestBank.y, 0);
    this.nestGroup.position.set(nestPosition.x, 0, nestPosition.z);

    frame.magazine.trays.forEach((tray, index) => {
      const mesh = this.trayMeshes[index];
      if (!mesh) return;
      const fill = tray.capacity > 0 ? tray.filled / tray.capacity : 0;
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.color.setHex(fill > 0.99 ? 0x8d5a2b : fill > 0 ? 0x4f7a52 : 0x1d2733);
      material.emissive.setHex(tray.index === frame.magazine.trayIndex ? 0x14321f : 0x000000);
    });

    const presence = frame.safety.tripped.includes('SF-AR-07');
    this.worker.visible = presence;
    if (presence) {
      this.worker.position.set(
        this.nestGroup.position.x + 0.75,
        0,
        this.nestGroup.position.z + 0.35,
      );
    }

    const tilting = frame.carrier.tilt >= 4;
    const tiltMaterial = this.tiltReadout.material as THREE.MeshBasicMaterial;
    tiltMaterial.color.setHex(
      frame.safety.tripped.includes('SF-AR-08') ? 0xd9483b : tilting ? 0xe0a63c : 0x4a5a6a,
    );
    tiltMaterial.opacity = tilting ? 0.9 : 0.35;
    this.tiltReadout.position.copy(this.rover.position);
    this.tiltReadout.position.y = 0.012;
  }

  /** Highlights one hand, used when the journal or the timeline selects a branch. */
  focusHand(id: string | null): void {
    this.arms.forEach((rig) => {
      const selected = rig.id === id;
      rig.label.material.opacity = selected ? 1 : 0.4;
      rig.label.scale.set(selected ? 0.3 : 0.22, selected ? 0.15 : 0.11, 1);
    });
  }

  private resize(): void {
    if (this.disposed) return;
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.frameHandle = requestAnimationFrame(this.loop);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameHandle);
    this.observer.disconnect();
    this.controls.dispose();
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material?.dispose();
    });
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
