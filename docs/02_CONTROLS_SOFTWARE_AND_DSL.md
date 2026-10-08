# 02 — Controls, ROS 2, simulation, and declarative task DSL

**Document:** AGR-SW-020 · **Revision:** A · **Status:** Architecture proposal

## 1. Technology decision

### Recommended stack: ROS 2 Jazzy + deterministic edge control + independent safety controller

Use **ROS 2 Jazzy on Ubuntu 24.04** for autonomy, perception, mapping, task execution, simulation integration, logging, and cassette APIs. Jazzy has Tier-1 Ubuntu 24.04 amd64/arm64 support and its published end-of-life is May 2029 ([ROS documentation](https://docs.ros.org/en/kilted/Releases/Release-Jazzy-Jalisco.html)). Pin package versions in a container/apt mirror and maintain a vulnerability/update policy; do not “latest” update a farm machine.

ROS 2 is preferred over a monolithic alternative because it gives a mature ecosystem for navigation, transforms, sensor drivers, rosbag replay, lifecycle nodes, simulation, and multi-vendor components. It is **not** the functional-safety system. The safety chain must still function if the ROS graph, GPU, Linux kernel, Wi-Fi, or a module microcontroller hangs.

| Layer | Recommended implementation | Can it command hazardous energy alone? |
| --- | --- | --- |
| Safety layer | Safety PLC or safety-capable MCU/I/O, dual-channel e-stop, safety lidar interfaces, bumper/tilt inputs, contactor/brake/tool-enable outputs | Yes, it is the final permission path; requirements derived from risk analysis |
| Motion layer | Motor/steering controllers on CAN-FD or EtherCAT, encoder/temperature feedback, hard speed/torque constraints | Only while safety enable is present |
| Real-time tool layer | Dedicated STM32/industrial MCU per cassette; watchdog; encoder/pressure/current sensing | Only while tool safe-enable is present |
| Autonomy layer | Industrial fanless x86 or Jetson-class compute, 16–32 GB RAM, NVMe, optional GPU; Ubuntu + ROS 2 Jazzy | No; produces bounded requests |
| Fleet/HMI layer | Separate service, VPN, RBAC, signed updates, audit store | No; loss must not defeat local stop behavior |

### Hardware communication topology

```text
                          ┌──────────── enterprise/farm LAN ─────────────┐
                          │ VPN • dashboard • recipe signing • backups   │
                          └──────────────────────┬────────────────────────┘
                                                 │ TLS / API, non-safety
 ┌───────────────────────────────────────────────▼─────────────────────────────────────────┐
 │ Autonomy computer: ROS 2 Jazzy / Cyclone DDS, mission executor, Nav2, perception, bags │
 │ sensor time sync (PTP where required) • local HMI • append-only event logger             │
 └───────┬───────────────────────────┬─────────────────────────┬────────────────────────────┘
         │ Ethernet                  │ CAN-FD/EtherCAT          │ hardwired heartbeat/state
 ┌───────▼────────┐           ┌──────▼──────────┐          ┌───▼────────────────────────────┐
 │ cameras/lidars │           │ motor + module  │          │ safety PLC / safety I/O          │
 │ GNSS/IMU       │           │ MCU controllers │          │ E-stop / lidar / bumper / tilt   │
 └────────────────┘           └─────────────────┘          │ contactors / brake / tool permit │
                                                            └─────────────────────────────────┘
```

Use an industrial managed Ethernet switch only when its power and failure behavior are understood. Safety signals remain wired or use a safety-rated fieldbus designed for the required integrity; ordinary DDS, CAN message CRCs, and Wi-Fi do not provide a safety claim by themselves.

## 2. ROS 2 node architecture

| Package / node | Responsibility | Lifecycle and failure behavior |
| --- | --- | --- |
| `agri_bringup` | Starts configuration-specific graph from signed inventory | Activates only after carrier/module manifest checks |
| `agri_safety_bridge` | Read-only safety status + bounded request interface | Never substitutes for hardwired stop; stale state inhibits mission |
| `agri_base` | Kinematics, odometry, motor request shaping | Limits `cmd_vel`; requires 50 Hz command heartbeat; timeout = zero request |
| `agri_localization` | Wheel/IMU/lidar/GNSS fusion and integrity monitor | Publishes covariance and validity; invalid maps to controlled stop or approved degraded mode |
| `agri_nav` | Nav2 route following, speed zones, docking approach | Cannot cross geofence or exceed cassette manifest speed |
| `agri_perception` | Detection/segmentation/tracking/quality gates | Emits measurement + covariance/model/data IDs, never direct actuator command |
| `agri_module_manager` | Authenticates cassette, loads manifest, checks latch/CG/tool envelope | Any mismatch = disable module and mission arm |
| `agri_executor` | Validates and executes compiled task graph | Only allow-listed actions; durable event journal |
| `agri_<module>` | EG/FD/CS/WD behavior controller | Separate process + MCU watchdog; deactivate -> physical safe state feedback |
| `agri_recorder` | Selective rosbag/event/video logging with retention policy | Priority storage quota; failure visible to operator |

Use lifecycle nodes. A mission may start only when required nodes are `active`, time is synchronized, storage is available, correct map/zone/checklist is selected, and the safety controller reports the permitted operating mode.

### Canonical interfaces

- Frames: `map → odom → base_link → cassette_link → tool_link`; module calibration writes an immutable transform bundle associated with its serial number.
- Commands: `geometry_msgs/Twist` is constrained at the base; tasks request `NavigateToPose`, `Dock`, `DispenseMass`, `PlaceEgg`, `ApplyVolume`, `InspectPlant`, `ActuateTool` actions—not raw motor PWM.
- Every actuation action carries: `mission_id`, `recipe_hash`, `module_serial`, `zone_id`, `max_duration`, `expected_state`, and idempotency key.
- State messages carry timestamp, sequence, quality/uncertainty, calibration ID, firmware version, and sensor health. Synchronize stereo/depth/camera/IMU with hardware timestamps or PTP where the error budget requires it.

## 3. Safety boundary and state model

The autonomy stack requests one of `SAFE_STOP`, `READY`, `MANUAL_SLOW`, `AUTO_TRAVEL`, `AUTO_TASK`, or `SERVICE`. The safety controller owns the authoritative mode and rejects illegal transitions. Examples:

| Event | Required immediate physical result | Software result |
| --- | --- | --- |
| E-stop / safety protective field | Traction torque removed, brake applied, hazardous tool energy removed | Mission aborts; requires inspection/reset sequence |
| ROS motion heartbeat loss | Controlled stop then brake; tools parked/de-energized | Record fault; no automatic resume |
| Module latch/ID mismatch | Tool and travel inhibited before movement | Unload configuration and request physical inspection |
| Localization integrity failure | Speed reduction then stop as risk policy demands | Mark route/task failed; retain data for diagnosis |
| Tool MCU heartbeat loss | Tool energy removed and tool parks/fails safe | Disable cassette; travel only if hazard analysis allows it |
| Low battery / thermal / insulation fault | No new task; controlled route-to-dock or immediate isolation by severity | Event and maintenance flag |

Stopping distance, field geometry, speed, fault reaction times, and required performance level/agricultural performance level are **outputs of the documented risk assessment**, not constants copied from a software package.

## 4. Module capability manifest

Every cassette has a signed `module.manifest.json` on a protected EEPROM and in the configuration repository. The carrier checks it against the physical connector/latch/sensors and an approved certificate list.

```json
{
  "schema": "agri.module/v1",
  "module_id": "WD-01-0042",
  "type": "weeding",
  "firmware": "2.3.1",
  "mass_kg": 72.4,
  "cg_mm": {"x": -35, "y": 12, "z": 340},
  "power": {"nominal_v": 48, "continuous_a": 18, "peak_a": 35},
  "capabilities": ["inspect_plant.v1", "mechanical_weed.v1"],
  "limits": {
    "max_travel_mps": 0.30,
    "max_grade_pct": 5,
    "tool_zone_class": "guarded_field",
    "requires_operator_present": true
  },
  "calibration_bundle": "sha256:...",
  "signature": "ed25519:..."
}
```

The manifest is an engineering assertion, not trust by itself: it is issued only after physical inspection, mass/CG measurement, electrical test, firmware review, and configuration-control approval.

## 5. Sapo-inspired `AgriScript` DSL

The requested “Sapo DSL” behavior is implemented as an **internal, typed, declarative recipe language**. It intentionally contains no arbitrary shell/Python evaluation. A compiler turns it into a versioned, allow-listed behavior tree (e.g. BehaviorTree.CPP XML or an equivalent internal representation). That makes recipes reviewable, portable across approved modules, and bounded by policy.

> There is no assumed API or compatibility with an external product called Sapo. If a specific Sapo grammar/runtime is required, treat it as an integration requirement and write an adapter after its specification/licensing is supplied.

### Grammar concepts

| Construct | Meaning | Mandatory checks |
| --- | --- | --- |
| `requires` | Required carrier/cassette capability and approved operating policy | Manifest, firmware, calibration, operator/certification policy |
| `preflight` | Checks before energy/motion/task transition | zone, battery, latch, safety, map, checklist, inventory |
| `steps` | Named actions/sequences | typed parameters, finite duration, retry bound, idempotency |
| `when` / `otherwise` | Guarded condition only; no raw code evaluation | condition source is allow-listed and timestamped |
| `on_fault` | Deterministic compensation / safe stop action | must not negate safety state |
| `evidence` | Events/data retained for audit | privacy/retention policy check |

### Example — periodic feed

```yaml
apiVersion: agri.script/v1
kind: Task
metadata:
  name: poultry-evening-feed
  version: 1.0.0
  owner: farm-ops
spec:
  requires:
    cassette: {type: feed, capability: dispense_mass.v1}
    operatorPolicy: supervisor_on_site
    zones: [house-3-feed-lane]
  limits:
    travel_mps: 0.40
    max_retries: 1
    deadline_s: 1800
  preflight:
    - carrier.safe_mode == READY
    - cassette.latch == LOCKED
    - feed.calibration.feed_lot == inventory.current_lot
    - route.house_3_feed_lane.commissioned == true
  steps:
    - navigate: {route: house-3-feed-lane, speed_mps: 0.40}
    - for_each: {in: route.stops, as: stop}
      do:
        - dock: {station: "${stop.id}", tolerance_mm: 40, timeout_s: 45}
        - dispense_mass: {kg: "${stop.kg}", max_s: 90, verify: loadcell}
        - record: {event: feed_delivered, fields: [station, commanded_kg, actual_kg]}
    - return_to: {location: feed-service-bay}
  on_fault:
    - safe_stop: {reason: task_fault}
    - notify: {role: stockperson, severity: high}
  evidence:
    retain: [recipe_hash, scale_trace, route_events, safety_events]
```

### Example — conservative weed action

```yaml
apiVersion: agri.script/v1
kind: Task
metadata: {name: guarded-early-weeding-crop-A, version: 0.3.0}
spec:
  requires:
    cassette: {type: weeding, capability: mechanical_weed.v1}
    operatorPolicy: supervisor_on_site
    zones: [plot-A-guarded]
  limits: {travel_mps: 0.25, deadline_s: 1200, max_retries: 0}
  preflight:
    - model.crop_A.version in approved_models
    - model.crop_A.validation.confidence_calibrated == true
    - localization.integrity == VALID
    - plot-A-guarded.access_state == RESTRICTED
  steps:
    - navigate: {route: plot-A-entry, speed_mps: 0.20}
    - scan_row:
        camera_profile: crop-A-early
        on_detection:
          when: "weed.confidence >= 0.98 && crop.clearance_mm >= 20 && pose.sigma_mm <= 3 && latency_ms <= 100"
          do: [{mechanical_weed: {target: weed, max_force_n: 25, timeout_ms: 350}}]
          otherwise: [{record: {event: abstained_detection, fields: [image_id, reason]}}]
  on_fault: [{park_tool: {}}, {safe_stop: {reason: task_fault}}]
```

The compiler rejects absent `on_fault`, raw shell expressions, unbounded loops, unsupported capabilities, tool actions outside an approved zone, values beyond module limits, unsigned models/recipes, and policies that conflict with the safety mode.

## 6. Simulation and AI workflow

1. **Single source of geometry:** CAD exports URDF/Xacro plus collision meshes and accurate mass/inertia; cassette serial/config generates the robot model.
2. **Mobility digital twin:** Start with Gazebo Harmonic for kinematics, routes, docking, stop/fault injection, and software-in-the-loop. Use hardware-in-the-loop CAN/safety I/O bench before a person/animal/plant trial.
3. **Vision digital twin:** Use recorded farm imagery as ground truth. Add Isaac Sim or a photorealistic renderer only if it measurably improves the domain gap; synthetic data never replaces held-out site data.
4. **Data governance:** Assign dataset/site/crop/lighting/season labels; version annotations and model weights; preserve calibration and train/validation/test split provenance; obtain farm/worker privacy approval for video.
5. **Deployment gates:** offline metrics → replay on unseen runs → shadow mode (no actuation) → guarded plot → supervised limited production. Roll back on drift/incident.
6. **Monitoring:** track confidence distribution, abstention rate, crop-proximity events, false actions, sensor exposure, calibration age, and changes in soil/light/cultivar. Flag drift before actuation policy changes.

This implements the useful Microduck principle—train/test behaviors in simulation and transfer carefully—while acknowledging that agricultural perception, chemicals, food handling, and shared animal spaces need much stronger site-specific validation.

## 7. Cybersecurity and update policy

- Mutual TLS/VPN for off-board services; unique robot and operator identities; least-privilege RBAC.
- Secure boot where hardware supports it; encrypted credential store; signed OS/container/firmware/model/recipe artifacts with SBOM and rollback image.
- No direct inbound internet port to a moving machine. Service access goes through a managed VPN/jump path.
- Separate operational telemetry from safety controls. A cloud outage must not change the local safe behavior.
- Patch in a staging robot/simulator; record configuration hash before/after; repeat regression and safety-relevant checks after change.
- Align lifecycle process with IEC 62443 concepts and target-market obligations; perform a threat model at PDR and each material architecture change.
