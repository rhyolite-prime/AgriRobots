# 10 — ARACNID: AR-01 carrier and EG-08 eight-hand egg collection cassette

**Document:** AGR-ARB-100 · **Revision:** A · **Status:** concept design basis / NOT FOR FABRICATION  
**Drawings:** [`AGR-120`](../drawings/AGR-120_AR01_CARRIER_GA.svg) · [`AGR-130`](../drawings/AGR-130_AR01_ARM_AND_HAND.svg) · [`AGR-210`](../drawings/AGR-210_EG08_ARACNID_EGG_MODULE.svg)  
**Task language:** [`dsl/examples/aracnid-egg-collection.agri`](../dsl/examples/aracnid-egg-collection.agri) on [`agri.task/v1`](../dsl/grammar/agri.task.v1.bnf)  
**Parent documents:** [`00_DESIGN_BASIS.md`](00_DESIGN_BASIS.md), [`01_MECHANICAL_DESIGN.md`](01_MECHANICAL_DESIGN.md), [`05_SAFETY_AND_COMPLIANCE.md`](05_SAFETY_AND_COMPLIANCE.md), [`09_DSL_AND_EXECUTION_ENGINE.md`](09_DSL_AND_EXECUTION_ENGINE.md)

## 1. What ARACNID is

ARACNID is the first **built** robot in this programme: an electric rover, **AR-01**,
carrying the **EG-08 "arachnid" cassette** — eight independent picking arms
arranged radially over a central egg-tray magazine. It collects eggs from a nest
bank, records each egg to its nest, hand, time and measured grasp trace, and
returns the filled trays to a service point.

It is deliberately a **supervised collection machine**:

- It picks and places. It does **not** wash, sanitise, coat, UV-treat or otherwise
  process shells — that is a separate validated process with its own owner and
  gate.
- It runs with a stockperson on site, inside a commissioned zone, at reduced
  speed, with an independent safety controller that owns stops and tool energy.
- Uncertain, dirty, cracked or abnormal eggs are **abstained** and flagged for
  human review, never force-picked.

ARACNID is the concrete use case for the DSL and engine: eight concurrent hands
are exactly the problem a bounded, permitted, verified task language exists to
describe.

## 2. Architecture decision

| Decision | Choice | Reason |
| --- | --- | --- |
| Vehicle | New **AR-01** carrier, wider track and higher payload rating than AP-01 | Eight deployed arms shift CG outward; stability, not chassis reuse, is the constraint |
| Payload | **EG-08** cassette on the existing **UCI-01** contract | Keeps the modular promise: FD-01/CS-01 can mount on AR-01, and EG-08 can mount on a future AP-02 field undercarriage |
| Interface geometry | UCI-01 footprint 900 × 580 mm, datum A, four captively retained M12 clamps, keyed power/data connector, latch/ID interlock | One interface, one exchange procedure, one interlock design |
| Payload rating | Carrier-specific: **AR-01 declares 165 kg**; EG-08 declares `min_payload_rating_kg = 135` in its manifest | A cassette may not silently exceed its carrier's rating; the manifest states the requirement and the carrier proves it |
| Locomotion | Four independent drive+steer wheel modules | Legged locomotion would multiply the safety case for no egg-collection benefit |
| Hands | Eight 3-DOF arms with compliant suction end effectors | Suction gives the lowest crack risk, is easy to instrument (vacuum + force) and easy to verify |
| Control | ROS 2 Jazzy autonomy + `agri-engine` executor + independent safety PLC/MCU | The engine requests; the safety controller decides |

## 3. AR-01 carrier — baseline targets

> Every value below is an **engineering target**, not measured data. Anything
> marked ⚠ must be confirmed by the site survey, a weigh-in, or a bench test
> before CDR.

| Parameter | Target | Note |
| --- | --- | --- |
| Envelope, arms stowed (bumpers) | 1,650 L × 1,150 W × 1,120 H mm | ⚠ must clear the narrowest doorway/aisle at the pilot house |
| Envelope, arms deployed | Ø 2,600 reach circle × 1,480 H mm | Defines the exclusion zone, not the travel corridor |
| Wheelbase / track | 1,250 / 950 mm | Wider than AP-01 for the deployed-arm stability case |
| Ground clearance / wheel OD | 210 / 450 mm | ⚠ floor condition, thresholds, slats and ramps at the site |
| Locomotion | 4 × independent drive + steer modules | 4WD/4WS, electronically limited by mode and zone |
| Energy | 48 V nominal, 120 Ah LiFePO₄ (5.76 kWh), removable keyed pack | ⚠ sortie energy budget measured on the bench, not calculated |
| Carrier dry mass | ≈ 245 kg | ⚠ weigh-in required |
| Payload rating at UCI-01 | 165 kg | Includes worst-case filled cassette |
| Speed, open / barn aisle / arms deployed near animals | 0.60 / 0.35 / 0.15 m/s | Caps are the minimum of task, manifest, zone and mode |
| Grade / obstacle / gap | 8 % / 30 mm / 120 mm | ⚠ site surfaces |
| Compute | Edge computer (ROS 2 Jazzy) + safety PLC/MCU + per-arm MCU | Safety path is physically separate from the autonomy compute |
| Sensing | 2 × 270° safety lidar, 2 × arm-envelope scanners, tilt, bumpers, wheel odometry, IMU, GNSS optional | People/animal protection is safety-rated and independent of perception models |
| Operator interface | Local HMI: mode, permits, hand status, abort, journal, recovery checklist | Must work with no network |

### 3.1 Stability and the deployed-arm case

The governing load case is **not** travel; it is eight arms extended on one side
with a partial magazine. Required before arms may be deployed on a vehicle:

1. measured cassette dry mass and CG, and the loaded CG at 0/50/100 % magazine;
2. worst-case arm pose set (all eight extended to maximum reach on one side)
   evaluated against the tip-over axis with the measured carrier mass;
3. bench test of the arm array on the 125 kg CG-adjustable dummy, then on the
   carrier with wheels off the ground, then tethered;
4. interlock: arms may only deploy when the carrier reports parked/braked and the
   safety controller grants `tool_energy`; deployment while moving is refused at
   the gate, not merely discouraged in software.

If the evaluated margin is insufficient, the remedies in order are: reduce
simultaneous deployment (interleave banks), add outriggers/ballast, reduce reach,
or widen the track. Reducing a software speed cap is **not** a stability remedy.

## 4. EG-08 cassette — baseline targets

| Parameter | Target | Note |
| --- | --- | --- |
| Footprint on datum A | 900 × 580 mm | UCI-01 |
| Stowed height above datum A | ≤ 850 mm | ⚠ door/lintel and CG consequences |
| Arm ring height above datum A | 620 mm | Eight shoulders on a ring, 45° apart, in two banks of four |
| Arm degrees of freedom | 3 per arm: shoulder yaw ±95°, elbow pitch −20°…+110°, wrist pitch ±75° | Plus passive hand compliance ±12° |
| Arm reach from shoulder | 620 mm | Deployed envelope Ø 2,600 mm |
| Hand payload | 0.12 kg per hand | ≈ 2 × a 60 g egg; factor covers acceleration and mis-grasp |
| End effector | Compliant silicone suction cup Ø 38 mm, vacuum differential 12–25 kPa | Food-contact material ⚠ requires approved material and migration review |
| Normal force limit | 12 N hard limit, 6 N nominal set point | Set in the hand MCU; the engine cannot raise it |
| Grasp sensing | Force 0–30 N ±0.2 N, vacuum decay for slip, cup-seal quality | Slip or seal loss → abort and record, never squeeze harder |
| Magazine | 6 × 30-egg trays = 180 eggs ≈ 10.8 kg, tilt-indexed | Tray RFID/QR for traceability |
| Throughput target | 12–18 eggs/min **verified**, not theoretical | Eight hands at 9–14 s cycles is ≈ 34–53/min theoretical; abstention, travel, verification and tray indexing consume the difference. Claim the measured number |
| Cassette dry mass / loaded | ≈ 118 kg / ≈ 129 kg | ⚠ weigh-in |
| CG above datum A | 340 mm dry / 355 mm loaded | ⚠ measured, then re-run stability |
| Power | 48 V auxiliary in; protected 24 V logic; 18 A continuous, 32 A peak | Pump + eight arms; connector thermal test required |
| Capabilities | `scan_nest.v1` (sensing), `pick_egg.v1`, `place_egg.v1` | Registered in the capability allow-list at gate **G6** with process approval |
| Cleaning | Arm array and tray bay hose-down to a contained path; no electronics in the wash zone | ⚠ cleanability and food-contact review before use with eggs |

### 4.1 Egg handling rules

1. Collection and traceability only. No shell treatment capability exists in the
   grammar, the allow-list or the manifest, and a test fails if one is added.
2. An egg is picked only when nest scan confidence, cup seal quality and force
   are inside approved bounds; otherwise the hand abstains and the egg is flagged.
3. Cracked, dirty or abnormal eggs are recorded as a segregated event and placed
   in the reject cradle, not in a saleable tray.
4. Every egg record carries: nest id, hand id, timestamp, commanded and measured
   force, vacuum trace, mass (where weighed), tray id and destination.
5. Animal welfare: no arm may enter an occupied nest when a bird is present
   unless the approved approach behaviour permits it; the guard in the task makes
   bird presence a breach condition that stops the block.

## 5. Capability and resource model

Eight hands make resource arbitration a first-class concern, so the grammar's
`parallel` branches address **resource instances**, not just classes.

| Resource | Kind | Exclusivity |
| --- | --- | --- |
| `traction` | carrier motion | exclusive |
| `tool.hand_1` … `tool.hand_8` | one picking arm | exclusive per instance, concurrent across instances |
| `tool.magazine` | tray indexing/tilt | exclusive |
| `sensing.nest_scan` | nest camera/vision | shared |
| `sensing.hand_cam` | per-hand cameras | shared |
| `logging`, `communication` | journal and telemetry | shared |

Compile-time rules: two branches may not claim the same instance; a branch that
claims `traction` may not run concurrently with any `tool.*` branch unless the
manifest declares motion-during-tool-use approved (EG-08 does **not**); the
magazine may not index while any hand is placing into it.

## 6. Safety functions specific to ARACNID

| ID | Function | Physical result | Software result |
| --- | --- | --- | --- |
| SF-AR-01 | E-stop (4 corners + HMI) | Traction torque removed, brakes applied, vacuum vented, arms held | Mission aborts; inspection/reset before re-arm; not auto-resumable |
| SF-AR-02 | Arm-envelope scanner breach | Affected arms stop and hold; traction inhibited | Guard breach → fault clause; journal records the arm and zone |
| SF-AR-03 | Hand force over limit | Hand MCU cuts suction and retracts | `verify` fails → `on_mismatch fault`; no retry without re-verification |
| SF-AR-04 | Vacuum/seal loss | Cup vents, hand opens | Recorded as slip/abstention; egg flagged, never re-squeezed |
| SF-AR-05 | Cassette latch / ID mismatch | Tool energy and travel inhibited | Manifest unload; physical inspection requested |
| SF-AR-06 | Deployed-arm motion interlock | Arms cannot deploy unless parked and permitted | Gate denial (exit code 4 class), journaled |
| SF-AR-07 | Bird/worker presence in the working cell | Arms hold, traction inhibited | Guard breach → degrade to `sensing_only` or fault |
| SF-AR-08 | Tip-over / tilt beyond limit | All energy removed, arms hold | Fault; no automatic recovery |
| SF-AR-09 | Heartbeat loss (engine, arm MCU, safety) | Controlled stop, vacuum vented, arms held | Fault; no automatic resume |
| SF-AR-10 | Magazine interlock | Tray bay cannot index while a hand is inside it | Compile-time and gate-time refusal |

Integrity targets, reaction times and stopping distances are outputs of the
formal risk assessment for this machine — they are not inherited from AP-01 and
not copied from a software package.

## 7. Task language consequences

ARACNID drove three grammar changes, all recorded in
[`dsl/grammar/agri.task.v1.bnf`](../dsl/grammar/agri.task.v1.bnf):

1. **Resource instances** — `<resource-spec> ::= <resource-class> [ "[" <resource-instance> "]" ]`,
   so eight concurrent arms are expressible and checkable.
2. **Per-bank permits** — `with_permit tool_energy` may scope a whole bank or a
   single hand, with a lease that expires on time, block exit, mode change, latch
   change or safety stop.
3. **Hand-indexed observation** — `observe … into $x` binds a per-hand result,
   and `for_each` over hands keeps an explicit `at_most 8` bound so a stuck hand
   cannot spin the loop.

The reference task is
[`dsl/examples/aracnid-egg-collection.agri`](../dsl/examples/aracnid-egg-collection.agri):
scan the nest bank, dispatch up to eight hands in parallel with per-hand
verification, index the magazine under an exclusive resource, abstain on low
confidence, and unwind through one `on_fault` clause that vents vacuum, holds
arms and notifies the stockperson.

## 8. Verification gates for ARACNID

| Gate | Evidence required |
| --- | --- |
| G-B1 hand bench | 500 pick/place cycles on real shells: crack rate, force trace, seal loss, cycle time, reject behaviour. A hand that cannot beat manual crack rate does not proceed |
| G-B2 arm bench | Reach, repeatability, collision envelope, joint thermal, emergency-stop reaction, scanner coverage |
| G-B3 magazine bench | Tray indexing with a hand inside the bay inhibited; RFID/QR read rate; cleanability |
| G4 UCI | 100 exchanges, mis-seat/open-latch/connector-unlocked faults, connector thermal at 32 A peak, worst-case loaded CG |
| G3' carrier | AR-01 mule: brakes, steering, stop distance, heartbeat loss, tilt, deployed-arm stability on the tethered rig |
| G6 egg readiness | End-effector force/crack data, materials and food-contact review, traceability completeness, animal-welfare review, process-owner sign-off |
| G8 pilot readiness | Full task run in simulation, replay and HIL with matching traces; operator and service training; incident and rollback procedures |
| G9 supervised pilot | Measured eggs/hour, crack rate, abstention rate, false picks, intervention rate, energy per sortie, cleaning time, and cost per egg versus the manual baseline |

The acceptance number that decides the project is **crack rate and cost per
egg against the manual baseline**, not throughput in a brochure.

## 9. Assumptions to close before CDR

1. Nest bank geometry: nest count, spacing, height, lip, litter depth, bird
   behaviour, and whether nests are single-tier or stacked. ⚠ Highest risk —
   eight arms need a working cell per hand.
2. Minimum aisle and doorway at the pilot house, and whether arms deploy inside
   the house or only at the nest bank.
3. Egg tray standard in use (30-egg flats vs. other), and tray handling by staff.
4. Wash-down requirements for the arm array and magazine, and the approved
   food-contact materials.
5. Flock health status, biosecurity entry procedure, and who authorises a robot
   inside a livestock building.
6. Lighting and dust at the nest face, which set the vision confidence threshold
   and therefore the abstention rate.
7. Power and charging location, and the sortie length the operation actually wants.
8. Local food-safety and animal-welfare rules for automated collection and for
   per-egg traceability claims.

### 9.1 What the simulation currently assumes

`packages/engine/src/aracnid-world.ts` (constant block `ARACNID`) and
[`apps/virtual-lab`](../apps/virtual-lab/README.md) execute against placeholders
for the assumptions above. They are recorded here so that a site answer replaces
a named number rather than being rediscovered, and so that no result from the
virtual lab is mistaken for a measured one.

| Topic | Value encoded today | Closes with |
| --- | --- | --- |
| Nest bank (1) | One bank 0.85 m ahead of the docked rover, 1.2 m wide, 0.35 m deep, 0.45 m high, 16 slots, single tier, no lip or litter model | Nest survey: count, spacing, tiers, lip, litter depth |
| Nest geometry (1) | Two layouts, selectable in the lab: `arc` — slots on a 0.8 m perimeter arc so all eight shoulders reach; `straight` — one 1.2 m run so only the nearest hands reach and the others abstain | Which of the two the pilot house actually presents |
| Aisle and deployment (2) | Rover docks at the nest face and deploys the arm ring there; no doorway or aisle traversal is modelled | Minimum aisle and doorway measurements |
| Tray standard (3) | 30-egg flats, six trays, tilt-indexed, 180-egg magazine | Tray standard in use and staff handling |
| Vision confidence (6) | Threshold 0.8; per-slot confidence drawn from the run seed; the `low-confidence` scenario uses 0.62 and abstains | Measured confidence and abstention rate at the nest face |
| Tip-over trip | 6 deg placeholder, with the task guard at 4 deg in `dsl/examples/aracnid-egg-collection.agri` (defence in depth: the guard trips first) | Static stability and CoG analysis for the deployed ring, then the AR-01 tilt test |
| Hand to egg assignment | Global: hands are offered eggs from one shared pool, so any hand may take any egg | Nest geometry (1) — a real cell constrains which hand reaches which nest |
| Arm envelope | Ring radius 0.31 m, ring height 620 mm, reach 620 mm, shoulder yaw +/-95 deg, elbow -20 to +110 deg, wrist 75 deg, 3 DOF per arm | G-B1 bench: reach, stiffness, repeatability |
| End effector | Compliant suction cup, 38 mm diameter, 12-25 kPa (nominal 18), force limits 6 N approach / 12 N lift / 30 N crush, 0.12 kg payload per hand | G-B1 bench: seal, force and drop tests on graded eggs |
| Motion | 0.60 m/s transit, 0.35 m/s approach, 0.15 m/s at the nest | Site speed limits and the aisle survey |
| Power (7) | 5 760 Wh usable from 92 % state of charge, decremented by motion and vacuum | Sortie length the operation wants, and the charging position |
| Egg properties | 55-75 g, three grades, shell tolerance below the nominal squeeze produces a crack that is counted against the robot | Flock and grading data |
| Physics | Kinematic twin only: poses, states and timings, no rigid-body dynamics, no contact model, no bird behaviour | `simulation/gazebo` and the HIL bench (both still placeholders) |

Every one of these is reachable from the lab without editing code: the scenario
picker, the seed, the nest layout, the egg count and the fault injector are the
five knobs, and the fault kinds are seal loss, vacuum decay, force overrun,
worker presence, tilt and a stale safety heartbeat.

Until these are answered, ARACNID is a **bench and simulation programme**. That
is not a delay: the hand bench (G-B1) and the DSL/engine work are the two things
that most reduce programme risk, and neither needs a site.
