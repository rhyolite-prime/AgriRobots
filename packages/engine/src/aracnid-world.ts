import type { SafetyState } from '@agrirobots/contracts';

import type { RuntimeValue } from './expr.ts';
import type { Quantity, StateSnapshot } from './state.ts';
import type {
  MissionIdentity,
  CapabilityCall,
  DispatchResult,
  TravelCall,
  TwinArm,
  TwinEgg,
  TwinFrame,
  TwinNestSlot,
  WorldModel,
} from './world.ts';

/**
 * Geometry and limits of the ARACNID reference machine, taken from
 * docs/10_ARACNID_AR01_DESIGN_BASIS.md and drawings AGR-120/130/210.
 * Anything marked "placeholder" is an assumption listed in docs/10 §9 and must be
 * closed before CDR; it is a constant here so the twin and the engine agree.
 */
export const ARACNID = {
  handCount: 8,
  /**
   * Shoulder base angles in degrees, hand_1 … hand_8: two banks of four, 45 deg
   * apart (docs/10 §5), bank 1 facing the nest. Published so a renderer draws
   * the ring the world actually uses instead of guessing it.
   */
  shoulderBaseAnglesDeg: [-67.5, -22.5, 22.5, 67.5, 112.5, 157.5, 202.5, 247.5],
  /** Shoulder ring radius, m (placeholder: ring diameter is not yet frozen). */
  ringRadiusM: 0.31,
  /** Arm ring height above datum A, mm (docs/10 §5). */
  ringHeightMm: 620,
  /** Maximum hand reach from its shoulder, mm (docs/10 §5). */
  reachMm: 620,
  shoulderYawDeg: 95,
  elbowPitchMinDeg: -20,
  elbowPitchMaxDeg: 110,
  wristPitchDeg: 75,
  handComplianceDeg: 12,
  handPayloadKg: 0.12,
  cupDiameterMm: 38,
  vacuumKpaMin: 12,
  vacuumKpaMax: 25,
  vacuumKpaNominal: 18,
  forceNominalN: 6,
  forceHardLimitN: 12,
  forceSensorRangeN: 30,
  trayCount: 6,
  trayCapacity: 30,
  trayEggCapacity: 180,
  speedOpenMs: 0.6,
  speedAisleMs: 0.35,
  speedArmsDeployedMs: 0.15,
  armSpeedMs: 0.22,
  /** Static tilt at which SF-AR-08 removes all energy (placeholder, docs/10 §9). */
  tiltTripDeg: 6,
  /** Task-side guard is tighter than the safety trip: defence in depth. */
  tiltGuardDeg: 4,
  nestBankDistanceM: 0.85,
  nestBankWidthM: 1.2,
  nestBankDepthM: 0.35,
  nestBankHeightM: 0.45,
  /**
   * Radius of the reference perimeter nest bank, m. With shoulders on a 0.31 m
   * ring and a 0.62 m reach, a bank at 0.80 m lets all eight hands work at once;
   * a straight run presents only the four front hands. Which one a real
   * lay-house has is the highest-risk open assumption in docs/10 section 9, so
   * both are modelled here.
   */
  nestArcRadiusM: 0.8,
  dockOffsetM: 0.35,
  batteryWh: 5760,
} as const;

export type AracnidScenario =
  | 'nominal'
  | 'low-confidence'
  | 'seal-loss'
  | 'cracked-egg'
  | 'worker-presence'
  | 'tilt-breach'
  | 'magazine-full'
  | 'fewer-eggs-than-hands';

export interface AracnidFault {
  /** Mission-relative time at which the fault becomes visible. */
  atMs: number;
  kind: 'seal_loss' | 'presence' | 'tilt' | 'force_overrun' | 'vacuum_decay' | 'heartbeat_gap';
  hand?: number;
  detail?: string;
}

export interface AracnidWorldOptions {
  scenario?: AracnidScenario;
  eggsInBank?: number;
  seed?: number;
  faults?: AracnidFault[];
  batteryPercent?: number;
  zone?: string;
  nestBankId?: string;
  /** `arc` = perimeter bank around the docked rover; `straight` = one nest run. */
  nestLayout?: 'arc' | 'straight';
  carrierId?: string;
  cassetteId?: string;
  /** Eggs already in the magazine when the mission starts. */
  magazineStartEggs?: number;
}

interface Egg extends TwinEgg {
  /** Shell tolerance in newtons; below it the shell cracks. */
  shellN: number;
  offered: boolean;
  slotIndex: number | null;
}

interface Slot extends TwinNestSlot {
  egg: Egg | null;
}

interface Arm extends TwinArm {
  baseAngleDeg: number;
  target: { x: number; y: number; z: number } | null;
  sealedAtMs: number | null;
}

/** Deterministic PRNG so a scenario replays identically. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Grade mix of a nominal bank. Damaged and dirty eggs are abstained by the scan,
 * never picked: the acceptance number that decides this project is crack rate
 * against the manual baseline (docs/10 §8).
 */
const GRADES = [
  'saleable',
  'saleable',
  'saleable',
  'saleable',
  'saleable',
  'saleable',
  'saleable',
  'saleable',
  'dirty',
  'undersized',
  'cracked',
];

/**
 * The ARACNID kinematic world.
 *
 * No rigid-body physics: arms are positioned by their joint limits and reach,
 * eggs are picked by suction with a force trace, and the carrier moves along a
 * straight aisle. That is exactly the fidelity the Virtual Lab needs to rehearse
 * a compiled task, and it is honest about what it does not model (docs/10 §9).
 */
export class AracnidWorld implements WorldModel {
  readonly carrierId: string;
  readonly cassetteId: string;
  readonly capabilities = ['scan_nest.v1', 'pick_egg.v1', 'place_egg.v1'];
  readonly motionDuringToolUse = false;

  private readonly random: () => number;
  private readonly scenario: AracnidScenario;
  private readonly nestLayout: 'arc' | 'straight';
  private readonly faults: AracnidFault[];
  private readonly appliedFaults = new Set<number>();
  private readonly slots: Slot[] = [];
  private readonly arms: Arm[] = [];
  private readonly eggs: Egg[] = [];
  private readonly trays: number[];

  private carrier = { x: 0, y: 0, heading: 0, speed: 0, parked: true, tiltDeg: 0.4 };
  private battery: number;
  private armsDeployed = false;
  private mission: MissionIdentity = {
    runId: 'aracnid-run',
    taskName: 'aracnid-egg-collection',
    taskVersion: '0.0.0',
  };
  private faultReason = '';
  private faultNode = '';
  private scanConfidence = 0.94;
  private crackFirstOffered = false;
  private scanned = false;
  private magazineIndexing = false;
  private handInBay = false;
  private slotConfirmed = true;
  private presence = false;
  private presenceZone = '';
  private envelopeClear = true;
  private heartbeatGapUntilMs = -1;
  private lastSafetySampleMs = 0;
  private tally = { offered: 0, picked: 0, placed: 0, cracked: 0, abstained: 0, rejected: 0 };
  private startMs = 0;

  constructor(options: AracnidWorldOptions = {}) {
    this.carrierId = options.carrierId ?? 'AR-01';
    this.cassetteId = options.cassetteId ?? 'EG-08';
    this.scenario = options.scenario ?? 'nominal';
    this.nestLayout = options.nestLayout ?? 'arc';
    this.random = mulberry32(options.seed ?? 20261009);
    this.battery = options.batteryPercent ?? 92;
    this.trays = Array.from({ length: ARACNID.trayCount }, () => 0);

    let startEggs = options.magazineStartEggs ?? 0;
    if (this.scenario === 'magazine-full') startEggs = ARACNID.trayEggCapacity;
    let remaining = startEggs;
    for (let tray = 0; tray < this.trays.length; tray += 1) {
      const fill = Math.min(ARACNID.trayCapacity, remaining);
      this.trays[tray] = fill;
      remaining -= fill;
    }

    const eggCount = options.eggsInBank ?? (this.scenario === 'fewer-eggs-than-hands' ? 5 : 16);
    this.layoutNestBank(
      options.nestBankId ?? 'nest-bank-3',
      eggCount,
      options.zone ?? 'lay-house-3',
    );
    this.layoutArms();

    this.faults = [...(options.faults ?? [])];
    if (this.scenario === 'seal-loss') this.faults.push({ atMs: 4000, kind: 'seal_loss', hand: 3 });
    if (this.scenario === 'worker-presence') {
      this.faults.push({ atMs: 6000, kind: 'presence', detail: 'a worker entered the aisle' });
    }
    if (this.scenario === 'tilt-breach') this.faults.push({ atMs: 6000, kind: 'tilt' });
    // A cracked egg is a property of the shell, not an injected fault: the first
    // offered egg gets a shell tolerance below the nominal squeeze, so the pick
    // itself cracks it and SF-AR-03/SF-AR-04 behaviour is exercised.
    this.crackFirstOffered = this.scenario === 'cracked-egg';
    if (this.scenario === 'low-confidence') this.scanConfidence = 0.62;
  }

  // -- layout ----------------------------------------------------------------

  private layoutNestBank(id: string, eggCount: number, zone: string): void {
    void zone;
    const dockX = ARACNID.nestBankDistanceM - ARACNID.dockOffsetM;
    const columns = 7;
    const rows = Math.ceil(eggCount / columns);
    for (let index = 0; index < eggCount; index += 1) {
      let x: number;
      let y: number;
      if (this.nestLayout === 'arc') {
        const angle = ((index * 360) / eggCount) * (Math.PI / 180);
        x = dockX + ARACNID.nestArcRadiusM * Math.cos(angle);
        y = ARACNID.nestArcRadiusM * Math.sin(angle);
      } else {
        const row = Math.floor(index / columns);
        const column = index % columns;
        x =
          ARACNID.nestBankDistanceM +
          (row - (rows - 1) / 2) * (ARACNID.nestBankDepthM / Math.max(1, rows));
        y = (column - (columns - 1) / 2) * (ARACNID.nestBankWidthM / columns);
      }
      const grade = GRADES[Math.floor(this.random() * GRADES.length)] ?? 'saleable';
      const massG = 52 + this.random() * 18;
      const egg: Egg = {
        id: `egg-${String(index + 1).padStart(2, '0')}`,
        massG: Number(massG.toFixed(1)),
        grade,
        cracked: grade === 'cracked',
        shellN: grade === 'cracked' ? 3.2 : 9 + this.random() * 6,
        offered: false,
        slotIndex: null,
      };
      this.eggs.push(egg);
      this.slots.push({
        id: `${id}-s${String(index + 1).padStart(2, '0')}`,
        x: Number(x.toFixed(3)),
        y: Number(y.toFixed(3)),
        z: ARACNID.nestBankHeightM,
        egg,
        scanned: false,
        confidence: 0,
      });
    }
  }

  private layoutArms(): void {
    for (let index = 0; index < ARACNID.handCount; index += 1) {
      const baseAngleDeg = ARACNID.shoulderBaseAnglesDeg[index] ?? index * 45 - 67.5;
      this.arms.push({
        id: `hand_${String(index + 1)}`,
        shoulderYaw: 0,
        elbowPitch: 0,
        wristPitch: 0,
        extension: 0,
        suctionKpa: 0,
        forceN: 0,
        holding: null,
        state: 'stowed',
        baseAngleDeg,
        target: null,
        sealedAtMs: null,
      });
    }
  }

  /** World position of a hand's shoulder, in metres. */
  private shoulderOf(arm: Arm): { x: number; y: number; z: number } {
    const radians = (arm.baseAngleDeg * Math.PI) / 180;
    return {
      x: this.carrier.x + ARACNID.ringRadiusM * Math.cos(radians),
      y: this.carrier.y + ARACNID.ringRadiusM * Math.sin(radians),
      z: ARACNID.ringHeightMm / 1000,
    };
  }

  // -- faults ----------------------------------------------------------------

  private applyFaults(nowMs: number): void {
    const elapsed = nowMs - this.startMs;
    this.faults.forEach((fault, index) => {
      if (this.appliedFaults.has(index) || elapsed < fault.atMs) return;
      this.appliedFaults.add(index);
      switch (fault.kind) {
        case 'seal_loss': {
          const arm = this.arms[(fault.hand ?? 1) - 1];
          if (arm) arm.state = 'fault';
          break;
        }
        case 'presence':
          this.presence = true;
          this.presenceZone = fault.detail ?? 'the working cell';
          break;
        case 'tilt':
          // Above the task's own 4 deg guard, below the 6 deg SF-AR-08 trip: the
          // guard must breach first, which is the defence-in-depth order.
          this.carrier.tiltDeg = ARACNID.tiltGuardDeg + 0.6;
          break;
        case 'force_overrun': {
          const arm = this.arms[(fault.hand ?? 1) - 1];
          if (arm) arm.forceN = ARACNID.forceHardLimitN + 1.5;
          break;
        }
        case 'vacuum_decay': {
          const arm = this.arms[(fault.hand ?? 1) - 1];
          if (arm) arm.suctionKpa = ARACNID.vacuumKpaMin - 4;
          break;
        }
        case 'heartbeat_gap':
          this.heartbeatGapUntilMs = nowMs + 1200;
          break;
        default:
          break;
      }
    });
  }

  /** Test/simulator hook: make a fault visible from now on. */
  bindMission(mission: MissionIdentity): void {
    this.mission = mission;
  }

  inject(fault: AracnidFault, nowMs: number): void {
    this.faults.push({ ...fault, atMs: Math.max(0, fault.atMs - (nowMs - this.startMs)) });
  }

  // -- WorldModel ------------------------------------------------------------

  snapshot(nowMs: number): StateSnapshot {
    // Fault timing is mission-relative, so the first sample anchors the clock.
    if (this.startMs === 0) this.startMs = nowMs;
    this.applyFaults(nowMs);

    const safetyStale = nowMs < this.heartbeatGapUntilMs;
    const sampledAtMs: Record<string, number> = {
      safety: safetyStale ? this.lastSafetySampleMs : nowMs,
      carrier: nowMs,
      cassette: nowMs,
      battery: nowMs,
      zone: nowMs,
      task: nowMs,
      inventory: nowMs,
      perception: this.scanned ? nowMs - 100 : nowMs,
    };
    if (!safetyStale) this.lastSafetySampleMs = nowMs;

    const magazine = {
      tray_index: this.currentTray(),
      slot_confirmed: this.slotConfirmed,
      indexing: this.magazineIndexing,
      hand_in_bay: this.handInBay,
      eggs: this.trays.reduce((total, fill) => total + fill, 0),
      capacity: ARACNID.trayEggCapacity,
    } as Record<string, RuntimeValue>;

    const tool: Record<string, RuntimeValue> = {
      holding_hands: this.arms
        .filter((arm) => arm.holding !== null)
        .map((arm) => ({
          id: arm.id,
          egg: arm.holding,
          transfer_key: `aracnid:${arm.id}:${arm.holding ?? ''}`,
        })),
      magazine,
    };
    this.arms.forEach((arm, index) => {
      tool[`hand_${String(index + 1)}`] = {
        holding: arm.holding,
        load_mass: { value: arm.holding ? this.massOf(arm.holding) : 0, unit: 'g' } as Quantity,
        seal_quality: this.sealQuality(arm),
        suction_kpa: { value: arm.suctionKpa, unit: 'kPa' } as Quantity,
        force_peak: { value: arm.forceN, unit: 'N' } as Quantity,
        state: arm.state,
        energy_enabled: arm.state !== 'fault',
      };
      sampledAtMs[`tool.hand_${String(index + 1)}`] = nowMs;
    });
    sampledAtMs['tool.holding_hands'] = nowMs;
    sampledAtMs['tool.magazine'] = nowMs;

    const holding = this.arms.filter((arm) => arm.holding !== null).length;
    return {
      tree: {
        carrier: {
          id: this.carrierId,
          parked: this.carrier.parked,
          tilt: { value: Number(this.carrier.tiltDeg.toFixed(2)), unit: 'deg' } as Quantity,
          arms_deployed: this.armsDeployed,
          pose: { x: this.carrier.x, y: this.carrier.y, heading: this.carrier.heading },
          speed: { value: this.carrier.speed, unit: 'm/s' } as Quantity,
        },
        cassette: {
          id: this.cassetteId,
          latch: 'LOCKED',
          manifest_payload_kg: { value: 129, unit: 'kg' } as Quantity,
          magazine,
        },
        tool,
        battery: {
          charge: { value: Number(this.battery.toFixed(1)), unit: '%' } as Quantity,
          state_of_charge: { value: Number(this.battery.toFixed(1)), unit: '%' } as Quantity,
        },
        safety: {
          mode: this.presence ? 'READY' : 'AUTO_TASK',
          e_stop: false,
          arm_envelope_clear: this.envelopeClear,
          presence_detected: this.presence,
          presence_zone: this.presenceZone,
          envelope_zone: this.envelopeClear ? '' : 'front-left',
        },
        localization: { valid: true, drift_mm: { value: 4, unit: 'mm' } as Quantity },
        perception: {
          nest_scan: {
            confidence: this.scanned ? this.scanConfidence : 0,
            eggs_offered: this.tally.offered,
          },
        },
        zone: { current_id: this.zoneName() },
        inventory: {
          eggs_stowed: this.trays.reduce((total, fill) => total + fill, 0),
          trays_filled: this.trays.filter((fill) => fill > 0).length,
          holding,
        },
        route: { 'lay-house-3': { commissioned: true } },
        operator: { present: true, role: 'supervisor' },
        environment: {
          temperature: { value: 18, unit: 'degC' } as Quantity,
          light_lux: { value: 40, unit: 'count' } as Quantity,
        },
        task: {
          name: this.mission.taskName,
          version: this.mission.taskVersion,
          run_id: this.mission.runId,
          fault_reason: this.faultReason,
          fault_node: this.faultNode,
        },
      },
      sampledAtMs,
      nowMs,
    };
  }

  private zoneName(): string {
    return this.carrier.x > ARACNID.nestBankDistanceM - 0.4 ? 'lay-house-3' : 'egg-room';
  }

  private massOf(eggId: string): number {
    const egg = this.eggs.find((candidate) => candidate.id === eggId);
    return egg ? egg.massG : 0;
  }

  private sealQuality(arm: Arm): string {
    if (arm.holding === null) return 'idle';
    if (arm.state === 'fault') return 'lost';
    if (arm.suctionKpa < ARACNID.vacuumKpaMin) return 'slipping';
    return 'good';
  }

  private currentTray(): number {
    const index = this.trays.findIndex((fill) => fill < ARACNID.trayCapacity);
    return index < 0 ? this.trays.length - 1 : index;
  }

  dispatch(call: CapabilityCall): DispatchResult {
    if (this.startMs === 0) this.startMs = call.nowMs;
    this.applyFaults(call.nowMs);

    switch (call.capability) {
      case 'scan_nest.v1':
        return this.scan(call);
      case 'pick_egg.v1':
        return this.pick(call);
      case 'place_egg.v1':
        return this.place(call);
      default:
        return {
          outcome: 'failed',
          durationMs: 0,
          errorCode: 'E_WORLD_UNSUPPORTED_CAPABILITY',
          message: `${call.capability} is not implemented by the ARACNID world`,
        };
    }
  }

  private scan(call: CapabilityCall): DispatchResult {
    this.scanned = true;
    this.armsDeployed = false;
    const minConfidence = numericArg(call.args['min_confidence'], 0.8);

    // Offer one reachable saleable egg per hand: `slot_N` belongs to `hand_N`,
    // because that is how the task indexes them. A hand with nothing inside its
    // own reach is offered nothing and abstains, which a quorum join tolerates.
    const reach = ARACNID.reachMm / 1000;
    const saleable = this.slots.filter(
      (slot) =>
        slot.egg !== null &&
        !slot.egg.cracked &&
        slot.egg.grade === 'saleable' &&
        !slot.egg.offered,
    );

    // Every hand/egg pair inside reach, closest first. Assigning globally rather
    // than hand-by-hand stops one hand from starving its neighbour out of the
    // only egg that neighbour can reach, and never offers one egg twice.
    const pairs: Array<{ hand: number; slot: Slot; distance: number }> = [];
    this.arms.forEach((arm, hand) => {
      const shoulder = this.shoulderOf(arm);
      for (const slot of saleable) {
        const distance = Math.hypot(slot.x - shoulder.x, slot.y - shoulder.y, slot.z - shoulder.z);
        if (distance <= reach) pairs.push({ hand, slot, distance });
      }
    });
    pairs.sort((left, right) => left.distance - right.distance || left.hand - right.hand);

    const taken = new Set<string>();
    const claimed = new Map<number, Slot>();
    for (const pair of pairs) {
      if (claimed.has(pair.hand) || taken.has(pair.slot.id)) continue;
      claimed.set(pair.hand, pair.slot);
      taken.add(pair.slot.id);
      if (pair.slot.egg) pair.slot.egg.offered = true;
    }

    const candidates: Array<{ slot: Slot; distance: number } | null> = this.arms.map(
      (arm, hand) => {
        const slot = claimed.get(hand);
        if (!slot) return null;
        const shoulder = this.shoulderOf(arm);
        return {
          slot,
          distance: Math.hypot(slot.x - shoulder.x, slot.y - shoulder.y, slot.z - shoulder.z),
        };
      },
    );
    const offeredSlots = candidates.filter(
      (entry): entry is { slot: Slot; distance: number } => entry !== null,
    );

    candidates.forEach((entry, index) => {
      if (!entry?.slot.egg) return;
      entry.slot.scanned = true;
      entry.slot.confidence = Number(
        Math.min(0.99, this.scanConfidence + this.random() * 0.05).toFixed(3),
      );
      entry.slot.egg.slotIndex = index + 1;
      if (this.crackFirstOffered && index === 0) {
        // A shell that will not survive the nominal squeeze.
        entry.slot.egg.shellN = ARACNID.forceNominalN * 0.5;
      }
    });

    for (const slot of this.slots) {
      // Eggs already damaged or out of grade are abstained by the scan and
      // flagged for the stockperson; they are never counted as our cracks.
      if (slot.egg && (slot.egg.grade !== 'saleable' || slot.egg.cracked)) this.tally.rejected += 1;
    }
    this.tally.offered = offeredSlots.length;
    this.tally.abstained += ARACNID.handCount - offeredSlots.length;

    const observations: Record<string, RuntimeValue> = {
      bank: String(call.args['bank'] ?? 'nest_bank_3'),
      confidence: this.scanConfidence,
      abstained: this.scanConfidence < minConfidence,
      slots_offered: offeredSlots.map((entry) => entry.slot.id),
      count: offeredSlots.length,
    };
    candidates.forEach((entry, index) => {
      observations[`slot_${String(index + 1)}`] = entry
        ? {
            id: entry.slot.id,
            x: entry.slot.x,
            y: entry.slot.y,
            z: entry.slot.z,
            mass_g: entry.slot.egg?.massG ?? 0,
            grade: entry.slot.egg?.grade ?? 'unknown',
            egg: entry.slot.egg?.id ?? null,
            confidence: entry.slot.confidence,
          }
        : null;
    });

    return {
      outcome: this.scanConfidence < minConfidence ? 'abstained' : 'ok',
      durationMs: 1800,
      observations,
      ...(this.scanConfidence < minConfidence
        ? {
            message: `scan confidence ${this.scanConfidence.toFixed(2)} is below ${minConfidence.toFixed(2)}`,
          }
        : {}),
    };
  }

  private pick(call: CapabilityCall): DispatchResult {
    const handName = String(call.args['hand'] ?? '');
    const arm = this.arms.find((candidate) => candidate.id === handName);
    if (!arm) {
      return {
        outcome: 'failed',
        durationMs: 0,
        errorCode: 'E_WORLD_UNKNOWN_HAND',
        message: `no hand named "${handName}"`,
      };
    }
    const slotValue = call.args['slot'];
    // Abstentions are counted once, at the offering stage (scan). A hand that
    // was offered nothing reports an abstained dispatch without re-counting.
    if (!slotValue || typeof slotValue !== 'object') {
      return {
        outcome: 'abstained',
        durationMs: 400,
        message: `${arm.id} was offered no egg`,
      };
    }
    const slotId = String((slotValue as Record<string, RuntimeValue>)['id'] ?? '');
    const slot = this.slots.find((candidate) => candidate.id === slotId);
    const egg = slot?.egg ?? null;
    if (!slot || !egg) {
      return {
        outcome: 'abstained',
        durationMs: 400,
        message: `${arm.id} found no egg at ${slotId}`,
      };
    }

    // Read the verdict before any state is written: a hand already flagged by an
    // injected fault keeps that verdict, and the seal is made then lost exactly
    // as SF-AR-04 describes.
    const faulted = arm.state === 'fault' || arm.forceN > ARACNID.forceHardLimitN;

    this.armsDeployed = true;
    this.carrier.parked = true;
    const shoulder = this.shoulderOf(arm);
    const distance = Math.hypot(slot.x - shoulder.x, slot.y - shoulder.y, slot.z - shoulder.z);
    if (distance > ARACNID.reachMm / 1000) {
      return {
        outcome: 'failed',
        durationMs: 900,
        errorCode: 'E_WORLD_OUT_OF_REACH',
        message: `${arm.id} cannot reach ${slot.id}: ${(distance * 1000).toFixed(0)} mm > ${String(ARACNID.reachMm)} mm`,
      };
    }

    // Kinematics-lite: yaw towards the slot, pitch from the reach fraction.
    const bearing = (Math.atan2(slot.y - shoulder.y, slot.x - shoulder.x) * 180) / Math.PI;
    const yaw = clampDeg(normaliseDeg(bearing - arm.baseAngleDeg), ARACNID.shoulderYawDeg);
    const reachFraction = distance / (ARACNID.reachMm / 1000);
    arm.shoulderYaw = Number(yaw.toFixed(1));
    arm.elbowPitch = Number(
      clampDeg(ARACNID.elbowPitchMaxDeg * reachFraction, ARACNID.elbowPitchMaxDeg).toFixed(1),
    );
    arm.wristPitch = Number((-20 - 30 * reachFraction).toFixed(1));
    arm.extension = Number(reachFraction.toFixed(3));
    arm.target = { x: slot.x, y: slot.y, z: slot.z };
    arm.state = 'reaching';

    const travelMs = Math.round((distance / ARACNID.armSpeedMs) * 1000);
    const sealMs = 900;
    const liftMs = 700;
    const durationMs = travelMs + sealMs + liftMs;

    arm.suctionKpa = faulted ? ARACNID.vacuumKpaMin - 5 : ARACNID.vacuumKpaNominal;
    arm.forceN = Number((ARACNID.forceNominalN * (0.8 + this.random() * 0.3)).toFixed(2));
    arm.sealedAtMs = call.nowMs + travelMs;
    arm.state = faulted ? 'fault' : 'sealing';

    // A cracked or fragile shell fails under the nominal squeeze.
    const cracks = arm.forceN > egg.shellN;
    if (cracks) {
      egg.cracked = true;
      arm.suctionKpa = ARACNID.vacuumKpaMin - 5;
      arm.state = 'fault';
      this.tally.cracked += 1;
      this.battery = Math.max(0, this.battery - 0.05);
      return {
        outcome: 'failed',
        durationMs,
        errorCode: 'E_EGG_CRACKED',
        message: `${egg.id} cracked at ${arm.forceN.toFixed(1)} N (shell tolerance ${egg.shellN.toFixed(1)} N); cup vented, egg flagged`,
        notes: ['SF-AR-03/SF-AR-04: suction cut, egg never re-squeezed'],
      };
    }

    if (faulted || arm.suctionKpa < ARACNID.vacuumKpaMin) {
      arm.suctionKpa = 0;
      arm.holding = null;
      this.battery = Math.max(0, this.battery - 0.04);
      return {
        outcome: 'failed',
        durationMs,
        errorCode: 'E_SEAL_LOSS',
        message: `${arm.id} lost vacuum on ${egg.id}; cup vented and the egg was left in the nest`,
        notes: ['SF-AR-04: seal loss'],
      };
    }

    arm.holding = egg.id;
    arm.state = 'holding';
    arm.forceN = Number(
      (egg.massG / 1000) * 9.81 > ARACNID.forceNominalN
        ? ARACNID.forceNominalN
        : ((egg.massG / 1000) * 9.81).toFixed(2),
    );
    slot.egg = null;
    this.tally.picked += 1;
    this.battery = Math.max(0, this.battery - 0.11);
    this.carrier.tiltDeg = Number((this.carrier.tiltDeg + 0.05).toFixed(2));

    return {
      outcome: 'ok',
      durationMs,
      notes: [`${arm.id} sealed on ${egg.id} at ${arm.suctionKpa.toFixed(0)} kPa`],
    };
  }

  private place(call: CapabilityCall): DispatchResult {
    const handName = String(call.args['hand'] ?? '');
    const arm = this.arms.find((candidate) => candidate.id === handName);
    if (!arm || arm.holding === null) {
      return {
        outcome: 'failed',
        durationMs: 200,
        errorCode: 'E_WORLD_HAND_EMPTY',
        message: `${handName || 'the hand'} is not holding an egg`,
      };
    }
    const tray = this.currentTray();
    if (
      this.trays[tray] === undefined ||
      this.trays.every((fill) => fill >= ARACNID.trayCapacity)
    ) {
      arm.state = 'holding';
      return {
        outcome: 'failed',
        durationMs: 600,
        errorCode: 'E_MAGAZINE_FULL',
        message: 'all six trays are full; the round must end and the magazine be unloaded',
      };
    }

    this.magazineIndexing = true;
    this.handInBay = true;
    this.slotConfirmed = false;

    const eggId = arm.holding;
    const egg = this.eggs.find((candidate) => candidate.id === eggId);
    const indexMs = 900;
    const releaseMs = 600;

    this.trays[tray] = (this.trays[tray] ?? 0) + 1;
    arm.holding = null;
    arm.suctionKpa = 0;
    arm.forceN = 0;
    arm.state = 'stowed';
    arm.extension = 0;
    arm.target = null;

    this.magazineIndexing = false;
    this.handInBay = false;
    this.slotConfirmed = true;
    this.tally.placed += 1;
    if (egg?.cracked) this.tally.rejected += 1;
    this.battery = Math.max(0, this.battery - 0.07);
    if (this.arms.every((candidate) => candidate.holding === null)) this.armsDeployed = false;

    return {
      outcome: 'ok',
      durationMs: indexMs + releaseMs,
      notes: [`${eggId} stowed in tray ${String(tray + 1)} at cell ${String(this.trays[tray])}`],
    };
  }

  travel(call: TravelCall): DispatchResult {
    const target = call.target;
    const limit = call.speedLimit
      ? Math.min(call.speedLimit.value, ARACNID.speedArmsDeployedMs)
      : ARACNID.speedAisleMs;
    if (this.armsDeployed && limit > ARACNID.speedArmsDeployedMs) {
      return {
        outcome: 'failed',
        durationMs: 0,
        errorCode: 'E_SPEED_WITH_DEPLOYED_ARMS',
        message: 'motion above 0.15 m/s with arms deployed is interlocked (SF-AR-06)',
      };
    }

    if (call.kind === 'move') {
      const distance = Math.abs(ARACNID.nestBankDistanceM - 0.35 - this.carrier.x);
      const durationMs = Math.max(1000, Math.round((distance / limit) * 1000));
      this.carrier.x = Number(
        (this.carrier.x + (this.carrier.x < 1 ? distance : -distance)).toFixed(3),
      );
      this.carrier.speed = limit;
      this.carrier.parked = false;
      this.battery = Math.max(0, this.battery - durationMs * 0.00004);
      return {
        outcome: 'ok',
        durationMs,
        notes: [`travelled to ${target} at ${limit.toFixed(2)} m/s`],
      };
    }

    // dock / return_to: creep the last 350 mm and brake
    const distance = Math.abs(ARACNID.nestBankDistanceM - 0.35 - this.carrier.x);
    const durationMs = Math.max(
      500,
      Math.round((distance / Math.min(limit, ARACNID.speedArmsDeployedMs)) * 1000),
    );
    this.carrier.x = Number((ARACNID.nestBankDistanceM - 0.35).toFixed(3));
    this.carrier.speed = 0;
    this.carrier.parked = true;
    return {
      outcome: 'ok',
      durationMs,
      notes: [`${call.kind} at ${target} within ${(call.tolerance?.value ?? 10).toFixed(0)} mm`],
    };
  }

  idle(durationMs: number): void {
    this.battery = Math.max(0, this.battery - durationMs * 0.000008);
    // Vacuum decays slowly on a sealed cup; the trace stays inside tolerance.
    for (const arm of this.arms) {
      if (arm.holding !== null && arm.suctionKpa > ARACNID.vacuumKpaMin) {
        arm.suctionKpa = Number(
          Math.max(ARACNID.vacuumKpaMin, arm.suctionKpa - durationMs * 0.0004).toFixed(2),
        );
      }
    }
  }

  /** `park_tool`: vent every cup, hold the arms where they are, remove energy. */
  parkTool(): DispatchResult {
    for (const arm of this.arms) {
      if (arm.holding !== null) {
        // A parked hand never drops an egg into the aisle: it keeps its seal at
        // the minimum holding vacuum until the magazine takes the egg.
        arm.suctionKpa = ARACNID.vacuumKpaMin;
      } else {
        arm.suctionKpa = 0;
        arm.forceN = 0;
        arm.state = 'stowed';
        arm.extension = 0;
        arm.target = null;
      }
    }
    this.armsDeployed = this.arms.some((arm) => arm.holding !== null);
    return {
      outcome: 'ok',
      durationMs: 800,
      notes: ['arms held, vacuum vented on empty hands, tool energy removed'],
    };
  }

  twinFrame(nowMs: number, safety: { state: SafetyState; tripped: string[] }): TwinFrame {
    return {
      t: nowMs,
      carrier: {
        x: this.carrier.x,
        y: this.carrier.y,
        heading: this.carrier.heading,
        speed: this.carrier.speed,
        parked: this.carrier.parked,
        tilt: this.carrier.tiltDeg,
        armsDeployed: this.armsDeployed,
        battery: Number(this.battery.toFixed(1)),
      },
      arms: this.arms.map((arm) => ({
        id: arm.id,
        shoulderYaw: arm.shoulderYaw,
        elbowPitch: arm.elbowPitch,
        wristPitch: arm.wristPitch,
        extension: arm.extension,
        suctionKpa: arm.suctionKpa,
        forceN: arm.forceN,
        holding: arm.holding,
        state: arm.state,
      })),
      magazine: {
        trayIndex: this.currentTray(),
        trays: this.trays.map((filled, index) => ({
          index,
          filled,
          capacity: ARACNID.trayCapacity,
        })),
        eggs: this.trays.reduce((total, fill) => total + fill, 0),
        capacity: ARACNID.trayEggCapacity,
      },
      nestBank: {
        id: 'nest-bank-3',
        x: ARACNID.nestBankDistanceM,
        y: 0,
        slots: this.slots.map((slot) => ({
          id: slot.id,
          x: slot.x,
          y: slot.y,
          z: slot.z,
          egg: slot.egg
            ? {
                id: slot.egg.id,
                massG: slot.egg.massG,
                grade: slot.egg.grade,
                cracked: slot.egg.cracked,
              }
            : null,
          scanned: slot.scanned,
          confidence: slot.confidence,
        })),
      },
      tally: { ...this.tally },
      safety,
    };
  }

  /** Scenario summary for the simulator's mission panel. */
  describe(): Record<string, RuntimeValue> {
    return {
      scenario: this.scenario,
      eggsInBank: this.eggs.length,
      hands: ARACNID.handCount,
      trayCapacity: ARACNID.trayEggCapacity,
      faults: this.faults.map((fault) => ({
        atMs: fault.atMs,
        kind: fault.kind,
        hand: fault.hand ?? null,
      })),
    };
  }
}

function clampDeg(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

/** Wraps an angle into (-180, 180] so a shoulder never slews the long way round. */
function normaliseDeg(value: number): number {
  let angle = value % 360;
  if (angle > 180) angle -= 360;
  if (angle <= -180) angle += 360;
  return angle;
}

function numericArg(value: RuntimeValue | undefined, fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'value' in value && typeof value.value === 'number') {
    return value.value;
  }
  return fallback;
}
