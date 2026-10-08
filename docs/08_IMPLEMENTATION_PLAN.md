# 08 — AMARS / AgriRobots implementation plan

**Document:** AGR-IMP-080 · **Revision:** A · **Status:** implementation baseline / planning aid  
**Source:** [`white_paper.md`](white_paper.md), reconciled with the AP-01 design package  
**Planning horizon:** 52 weeks after pilot-site selection  
**Applies to:** Virtual Lab, simulation/AI pipeline, AgriScript execution path, AP-01 carrier, UCI-01, and EG-01/FD-01/CS-01/WD-01 cassettes

## 1. Purpose and implementation stance

The white paper defines the product vision:

```text
Nuxt.js Virtual Lab → simulation and AI → compiled task/runtime artifact → edge robot
```

This plan turns that vision into an executable program. It deliberately does **not** treat a browser, cloud service, perception model, ROS graph, or OTA link as a safety controller. The safety carrier, independent safety controller, module contracts, operating design domain (ODD), and gate evidence in the existing design package remain authoritative for physical operation.

The first implementation is a **single-robot, supervised vertical slice**:

1. assemble an AP-01 plus an approved cassette in the Virtual Lab;
2. validate the module manifest, mass/CG, connector, capabilities, and operating zone;
3. export a digital-twin configuration;
4. author and compile a bounded AgriScript recipe;
5. run it in simulation, replay, and hardware-in-the-loop (HIL);
6. deploy the signed artifact to one edge computer; and
7. execute only after the physical safety controller grants permission.

Fleet broadcast, reinforcement-learning motor policies, autonomous egg treatment, and unsupervised operation are later capabilities, not prerequisites for the first useful release.

### 1.1 Source-of-truth reconciliation

The white paper and the current design package use different maturity levels and some different nominal values. These differences must be resolved through configuration control rather than silently combined.

| White-paper concept | Implementation baseline | Decision rule |
| --- | --- | --- |
| AMARS / modular AGV | AP-01 carrier + UCI-01 + named cassettes | AP-01 drawings and design-basis requirements control the first physical build. |
| Nuxt.js 4.x Virtual Lab | New `apps/virtual-lab` application | Build the minimum useful assembly/manifest/recipe workflow before a broad CAD or circuit suite. |
| Three.js/WebGPU and GLTF/URDF | Three.js/TresJS with WebGL fallback; URDF/Xacro and GLTF asset ingestion | WebGPU is an optimization, not a browser compatibility requirement. |
| Omniverse / Isaac Sim / Gazebo WASM | Gazebo Harmonic first; Isaac Sim only when a measured vision-domain-gap benefit justifies it | Simulation must reproduce routes, docking, faults, and replay before photorealistic generation. |
| AgriDSL / `.ags` and Sapo-style language | Existing `agri.script/v1` YAML → typed IR → bounded executor | Do not create a second grammar. Add adapters/export formats only after the internal semantics are stable. |
| Drogon/C++23 edge runtime | ROS 2 Jazzy integration plus deterministic module controllers and an independent safety controller | C++ may implement the edge executor, but it never replaces the hardwired/safety-rated stop path. |
| 24 V / 30 A white-paper UTC example | AP-01 UCI-01 contract: 48 V auxiliary feed, protected 24 V, data, safety discrete, and optional fluid lines | Final voltage/current/connector selection is a CDR output based on thermal, isolation, and safety tests. |
| Twenty-robot swarm | One robot, then two-robot supervised coordination | Fleet behavior is enabled only after the single-robot pilot and signed-update rollback tests pass. |

## 2. Outcomes and release boundaries

### 2.1 Release R0 — engineering vertical slice

R0 is complete when a developer can run a reproducible path with the AP-01 and FD-01 reference assets:

- load AP-01 and FD-01 geometry in the Virtual Lab;
- snap the cassette to UCI-01 and reject an invalid/missing latch or capability;
- inspect power/data/safety mappings, mass/CG, limits, and calibration IDs;
- export a versioned robot/module manifest and URDF configuration;
- open `poultry-evening-feed.yaml`, validate it, display the compiled graph, and reject an unsafe/unsupported change;
- simulate navigation, docking, dose verification, fault, safe stop, and recovery;
- run the same recipe through replay/HIL using the same canonical IR;
- produce an append-only execution journal with recipe hash, module serial, map/zone, software/model versions, commands, results, and safety events; and
- package a signed artifact that the edge runtime verifies before execution.

R0 is not permission to operate on a farm. It is the software and bench-integration release needed to reach G3/G4/G5.

### 2.2 Release R1 — supervised pilot platform

R1 adds the released carrier mule, UCI-01, at least one benign cassette, operator HMI, supervised route execution, service procedures, and the evidence required for G8. The initial field task should normally be FD-01 or another low-consequence task selected at G0; the project must not make egg or weed actuation the first end-to-end vehicle test merely because the white paper uses egg picking as an example.

### 2.3 Release R2 — task expansion and fleet research

R2 adds approved EG-01 and WD-01 capabilities only after their independent process and safety gates. It may then add multi-robot task allocation, staged OTA, and a second robot. Swarm coordination remains non-safety orchestration: loss of fleet connectivity must not defeat local stop behavior or create an unsafe resume.

## 3. Architecture to implement

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Virtual Lab: Nuxt 4 / Vue 3 / Three.js                                       │
│ assembly • UCI/module registry • pin/capability inspector • recipe review    │
└──────────────┬──────────────────────────────┬────────────────────────────────┘
               │ canonical design/twin spec    │ recipe + policy inputs
               ▼                               ▼
┌──────────────────────────────┐  ┌────────────────────────────────────────────┐
│ Digital twin + AI pipeline   │  │ AgriScript compiler and policy service      │
│ URDF/Gazebo • replay • HIL   │  │ schema → semantic checks → bounded IR       │
│ datasets • model registry    │  │ sign → journal → approved deployment        │
└──────────────┬───────────────┘  └─────────────────┬──────────────────────────┘
               │                                    │ signed config/recipe/model
               └────────────────────┬───────────────┘
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Edge robot                                                                    │
│ ROS 2 Jazzy: Nav2, perception, executor, recorder, module manager           │
│ deterministic motor/tool controllers                                         │
│ independent safety PLC/MCU: E-stop, protective fields, latch, brake, permit  │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                     local safety permit only when all gates agree
                                    ▼
                    AP-01 carrier + approved cassette
```

### 3.1 Repository target layout

The repository currently contains the design package and DSL draft, but no application or robot runtime. Add implementation code incrementally using the following boundaries:

```text
apps/
  virtual-lab/                 # Nuxt 4 application and browser studio
packages/
  domain-model/                # AP-01/UCI/module/zone schemas and IDs
  asset-import/                # GLTF, URDF/Xacro, collision and metadata checks
  compiler-core/               # AgriScript AST, semantic checks, deterministic IR
  contracts/                   # versioned JSON/Protobuf action/state/event contracts
  policy/                      # capability, ODD, operator and chemical/food rules
ros_ws/
  src/agri_bringup/
  src/agri_safety_bridge/
  src/agri_base/
  src/agri_localization/
  src/agri_nav/
  src/agri_perception/
  src/agri_module_manager/
  src/agri_executor/
  src/agri_recorder/
  src/agri_fd/ agri_eg/ agri_cs/ agri_wd/
simulation/
  gazebo/                      # worlds, URDF/Xacro, fault injection and scenarios
  replay/                      # recorded-run and dataset playback
  hil/                         # CAN/safety-I/O bench adapters
ai/
  datasets/                    # manifests, labels, splits and governance
  training/                    # reproducible CV/RL jobs
  evaluation/                  # held-out, replay and drift reports
fleet/
  control-plane/               # non-safety registry, rollout and audit services
  schemas/                     # robot, artifact and deployment manifests
recipes/                       # reviewed AgriScript examples and fixtures
test_evidence/                 # VVT-* records, reports and configuration hashes
```

The exact language and build tooling may be selected at project bootstrap, but each boundary must have a versioned contract and a test harness. A UI must not import ROS internals directly; an edge process must not trust UI state; and a safety controller must not depend on either.

## 4. Workstreams and implementation tasks

### WS-A — requirements, safety, and configuration control

**Owner:** systems/safety lead  
**Starts:** week 0  
**Depends on:** pilot site and named process owners

1. Complete the site-discovery questionnaire and create the dimensioned route/plot map.
2. Freeze the first ODD: routes, grades, surfaces, people/animal co-presence, weather, lighting, connectivity, battery/charge window, and approved cassette mass/CG.
3. Create a requirements database linking white-paper capabilities to `SYS-*`, module requirements, software requirements, hazards, test cases, and `VVT-*` evidence.
4. Allocate SF-01…SF-08 to the independent safety controller, drive/tool hardware, and monitored autonomy interfaces; assign required integrity targets from the formal risk assessment.
5. Define configuration IDs for CAD, URDF, firmware, ROS packages, maps, recipes, models, calibration bundles, and manifests.
6. Establish the change-control board, incident protocol, review cadence, artifact signing, retention, and rollback rules.

**Exit:** G0 site/ODD decision and G1 safety/system architecture review. No fabrication or actuation pilot proceeds with unresolved geometry, process ownership, or safety allocation.

### WS-B — Virtual Lab foundation

**Owner:** web/platform lead  
**Starts:** week 5; repository/bootstrap work starts at week 0  
**Depends on:** WS-A domain IDs and UCI contract

#### R0 features

- Nuxt 4 + Vue 3 Composition API + TypeScript shell with route-level permissions.
- Module registry containing AP-01, UCI-01, and one reference cassette manifest.
- Three.js/TresJS assembly canvas with GLTF preview, URDF metadata, coordinate frames, datum/snap points, collision envelope, and mass/CG display.
- UCI validator: envelope, datum, latch, connector, power, data, safety-discrete, fluid, capability, and operating-limit checks.
- Event inspector fed by a simulator/replay WebSocket stream; events include timestamp, source, sequence, quality, configuration ID, and safety state.
- Design export: canonical digital-twin specification, URDF/Xacro configuration, module manifest, calibration references, and content hashes.
- Recipe review panel: source YAML, schema errors, semantic/policy errors, compiled behavior graph, limits, required capabilities, and evidence retention.

#### Later features

- Circuit/pin designer with a validated pin map and electrical interlocks. It is not a replacement for released wiring diagrams or a safety PLC configuration tool.
- Multi-user session collaboration using an authenticated WebSocket gateway. WebRTC is optional and not part of the safety or R0 execution path.
- WebGPU renderer, richer joint/kinematic editing, and external CAD/URDF asset ingestion after the reference workflow is stable.

**Exit:** A clean user can assemble AP-01 + FD-01, see every invalid-state explanation, export a reproducible twin spec, and review a compiled recipe without direct filesystem or robot access.

### WS-C — AgriScript compiler, policy, and execution contracts

**Owner:** language/runtime lead  
**Starts:** week 2  
**Depends on:** existing `dsl/schema`, module manifests, safety/ODD policy

1. Define canonical state, action, event, error, and capability contracts. Use typed units and explicit timestamps; avoid free-form JSON for safety-relevant values.
2. Implement duplicate-key-safe YAML parsing and the existing `agri.script/v1` JSON Schema validation.
3. Implement semantic validation for finite loops, deadlines, retry bounds, idempotency, `on_fault`, approved capabilities, module limits, route/zone, operator policy, model/calibration approval, and chemical/food process permissions.
4. Compile to a deterministic versioned behavior-tree/intermediate representation (IR). The same compiler core must run in CI, the Virtual Lab, and the edge deployment tool; browser compilation may use a WASM build of the core.
5. Sign the canonical recipe, IR, referenced model/calibration bundle, map revision, and deployment manifest. Verify all hashes before execution.
6. Implement an executor adapter to ROS 2 actions such as `NavigateToPose`, `Dock`, `DispenseMass`, `PlaceEgg`, `ApplyVolume`, `InspectPlant`, and `ActuateTool`; never expose raw motor PWM or arbitrary shell/Python evaluation.
7. Implement append-only event journaling, cancellation, safe-stop, compensation/park behavior, and explicit resume rules. A safety stop is not automatically resumable.
8. Add conformance fixtures for every allow-listed capability and every rejection class.

**Exit:** Valid recipes produce byte-for-byte reproducible IR; invalid recipes fail before actuation with an actionable reason; a signed artifact cannot run with a wrong module, map, model, calibration, zone, or safety mode.

### WS-D — digital twin, replay, and HIL

**Owner:** simulation/robotics lead  
**Starts:** week 6  
**Depends on:** WS-B design export and WS-C contracts

1. Export accurate AP-01/UCI/cassette geometry, mass, inertia, collision, wheel, steering, brake, sensor, and tool metadata from the canonical model.
2. Build the first Gazebo Harmonic worlds for a surveyed corridor, dock, feed station, and fault area. Use the same frames (`map → odom → base_link → cassette_link → tool_link`) as the edge system.
3. Simulate nominal routes plus localization loss, sensor contamination, latch mismatch, heartbeat loss, protective stop, low battery, tool timeout, dose disagreement, and network outage.
4. Build record/replay for ROS events, camera/depth data, model versions, calibration, recipe hash, map/zone, and safety status. Use replay for regression rather than relying on live demonstrations.
5. Connect the power/safety HIL bench to the software executor and module controllers. Prove that injected faults produce the same safe state in simulation, HIL, and vehicle tests.
6. Add Isaac Sim/photorealistic generation only if a documented comparison shows that it improves an agreed perception metric on held-out site data. Synthetic images do not replace site data or safety evidence.

**Exit:** R0 recipe runs through nominal, timeout, localization-loss, module-mismatch, and safe-stop scenarios with matching expected event traces; HIL passes before autonomous vehicle motion.

### WS-E — edge autonomy and safety integration

**Owner:** robotics/embedded lead with safety engineer  
**Starts:** week 6  
**Depends on:** WS-A, WS-C, WS-D

1. Stand up ROS 2 Jazzy packages for bring-up, safety bridge, base, localization, Nav2, perception, module manager, executor, and recorder.
2. Keep the safety controller authoritative for `SAFE_STOP`, `READY`, `MANUAL_SLOW`, `AUTO_TRAVEL`, `AUTO_TASK`, and `SERVICE` transitions.
3. Enforce bounded commands, heartbeats, watchdogs, speed zones, module limits, and no-auto-resume rules in the base/module controllers.
4. Implement signed inventory checks: carrier, cassette serial, firmware, calibration, model, map, recipe, operator policy, and required safety self-test.
5. Implement health and quality states for every sensor and controller. Loss of required localization, time sync, storage, or module heartbeat must follow the approved degraded-mode policy.
6. Build local HMI and service diagnostics; a cloud/fleet outage must leave local stop and recovery behavior intact.
7. Bring up the carrier in the hardware sequence from [`07_HARDWARE_BUILD_GUIDE.md`](07_HARDWARE_BUILD_GUIDE.md): wheels-off-ground → tethered brakes-only → tethered full mule → radio teleop → supervised autonomy.

**Exit:** G3 safety mule evidence and the ROS/HIL conformance suite pass. ROS 2 is not accepted as the sole safety mechanism.

### WS-F — carrier, UCI, and task cassettes

**Owner:** mechanical/electrical/module leads  
**Starts:** benches at week 2; carrier build after G2  
**Depends on:** site survey, safety allocation, CDR, long-lead evidence

1. Build the power/safety HIL panel, wheel-module bench, adjustable 125 kg dummy cassette, feed metering bench, egg end-effector rig, fluid bench, and weed camera/tool rig.
2. Bench wheel torque, thermal, brake, encoder plausibility, steering, and stop behavior. Do not use catalogue values as acceptance evidence.
3. Release AP-01 fabrication drawings, FEA, wiring/insulation plan, mass/CG database, P&ID, and service/LOTO procedures at G2.
4. Build the carrier mule without autonomy compute and pass G3.
5. Build UCI-01 and pass 100 exchanges, mis-seat/open-latch/connector-unlocked faults, connector thermal/derating, ID/manifest interlock, and worst-CG stability at G4.
6. Integrate FD-01 and CS-01 only after bench calibration; pass dose/flow/coverage/containment and cleanability evidence at G5.
7. Integrate EG-01 only after end-effector force, egg handling, material, traceability, animal-welfare, and process-owner review at G6. The initial implementation collects and traces eggs; it does not assume shell treatment is legal or validated.
8. Develop WD-01 in shadow mode first. Enable actuation only in a guarded plot after crop-specific held-out metrics, calibration, latency, exclusion-radius, placement, force, and crop-protection evidence pass G7.

**Exit:** Each cassette has its own manifest, calibration bundle, operating procedure, hazard analysis, V&V report, and release decision. One cassette passing never waives another cassette's gate.

### WS-G — data, perception, and policy models

**Owner:** CV/ML + agronomy lead  
**Starts:** data agreements at week 0; WD-01 data work at week 12  
**Depends on:** site consent, sensor/calibration plan, ODD, process owners

1. Define data governance for farm, worker, animal, crop, and video records before collection.
2. Version dataset manifests, label guides, site/crop/lighting/season metadata, train/validation/test splits, calibration, and model provenance.
3. Use recorded site data as the baseline. Generate synthetic data only with controlled domain randomization and measurable comparison to held-out real data.
4. Start with perception outputs containing object/pose/quality/uncertainty and model ID; perception never directly commands a hazardous actuator.
5. For WD-01, implement confidence calibration and abstention. A failed threshold records `abstained_detection`; it never retries indefinitely or reduces the crop-exclusion margin automatically.
6. If RL is used, train in simulation with bounded action spaces, safety shields, scenario randomization, and deterministic regression tests. Deploy learned policies only as approved bounded action blocks with time/force/velocity limits.
7. Monitor drift, abstention rate, false actions, crop proximity, sensor contamination, calibration age, and lighting/soil/cultivar changes.

**Exit:** Offline metrics, unseen-run replay, shadow-mode evidence, and guarded-task evidence exist for the target site. A model card and rollback artifact accompany every approved model.

### WS-H — fleet, OTA, and operations

**Owner:** platform/cybersecurity + field operations leads  
**Starts:** service registry at week 24; multi-robot work after G8 preparation  
**Depends on:** single-robot signed artifacts, audit journal, local-safe behavior

1. Build a non-safety fleet registry for robot identity, cassette serials, firmware/models/recipes, maps, calibration, health, and last-known configuration.
2. Implement mutual authentication, RBAC, VPN/jump access, signed artifacts, SBOM/configuration hashes, staged rollout, rollback, and update failure recovery.
3. Keep telemetry, fleet allocation, MQTT/ZeroMQ/WebSocket coordination, and dashboards separate from safety controls.
4. Implement single-robot OTA in a bench/simulator, then a staging robot, then a supervised pilot robot. The robot must not execute an unapproved or partially installed bundle.
5. Add leader/follower or task-redistribution experiments only after local route/mission behavior is stable. A handover must carry mission state, recipe hash, zone, module state, and operator approval; it must not assume another robot can safely resume at an arbitrary physical state.
6. Train operators and service staff on inspection, cassette exchange, charging, cleaning, recovery, LOTO, incident reporting, and rollback.

**Exit:** G8 review accepts update, access, recovery, service, spare, training, and incident procedures; G9 pilot data supports a controlled release decision.

## 5. Integrated schedule and gates

The white paper's four two-month phases are retained as program themes, but the physical program uses the existing 52-week gates because safety, procurement, and site validation cannot be compressed into a software demo.

| Gate / weeks | Program increment | Primary outputs | Exit evidence / decision |
| --- | --- | --- | --- |
| G0 / 0–4 | Discover and scope | Site survey, ODD v1, first two module priorities, process/legal owners, data permissions, team and backlog | Site fit and geometry signed; AP-01 versus AP-02 decision; no unresolved show-stopper |
| G1 / 2–8 | Architecture and safety | System architecture, hazard analysis, safety allocation, contracts, threat model, Virtual Lab skeleton, HIL design | PDR approves boundaries, integrity targets, data/configuration plan, and R0 acceptance tests |
| G2 / 5–12 | Detailed design and procurement | CAD/FEA, wiring/P&ID, mass/CG, URDF export, Gazebo reference world, compiler prototype, long-lead bench parts | CDR releases build drawings and test plan; no fabrication from concept SVGs alone |
| G3 / 13–18 | Carrier safety mule | AP-01 mule, safety controller, brakes, drive/steer, teleop, basic logging | E-stop, protective stop, overspeed, heartbeat, tilt, mode transitions and measured stop distance pass |
| G4 / 19–20 | UCI and digital-twin contract | UCI-01, dummy cassette, ID/manifest, connector, thermal test, assembly workflow | 100 exchanges, fault interlocks, connector/CG/stability tests pass |
| G5 / 21–28 | Benign task vertical slice | FD-01 and/or CS-01, calibrated task bench, R0 signed recipe path, supervised route/dock | Dose/flow/containment/cleanability and no-uncontrolled-spill criteria pass |
| G6 / 29–32 | Egg readiness | EG-01, nest/egg rig, traceability, force/crack data, process decision | Collection gate passes; shell treatment remains disabled unless separately approved and validated |
| G7 / 33–38 | Weed guarded release | Site dataset/model, shadow mode, WD-01 guarded tool, crop-protection evidence | Actuation gate passes, otherwise WD-01 remains sensing-only |
| G8 / 39–44 | Integrated pilot readiness | Requirement coverage, fault injection, EMC/environment checks, operator/service/cyber/update package | Independent safety/process review authorizes limited supervised pilot |
| G9 / 45–52 | Supervised pilot and review | Pilot logs, KPI/incident review, service/economic data, release recommendation | Iterate, extend pilot, or release a controlled production design; no automatic scale-up |

### Parallelism rules

- Virtual Lab, contracts, simulation, site discovery, data governance, and bench fixtures run in parallel.
- Carrier fabrication waits for G2; autonomy waits for G3 safety-mule evidence before people/animals are introduced.
- Cassettes are bench-proven before vehicle integration and gated independently.
- AI dataset work may begin early, but no model can enable actuation before the relevant task gate.
- Fleet work may exercise simulated robots early, but physical multi-robot operation waits for G8/G9 evidence.

## 6. Definition of done and verification strategy

Every implementation item is complete only when all applicable conditions hold:

- code/configuration is reviewed and versioned;
- unit, contract, integration, fault, and regression tests are automated where practical;
- the exact artifact/configuration hashes are recorded;
- the behavior is observable through typed state/events and a durable journal;
- negative paths are tested, including stale state, missing capability, invalid signature, timeout, disconnect, and safe stop;
- the requirement, hazard, or design decision has a named owner and linked `VVT-*` evidence;
- simulator/replay and HIL results are reproducible from a documented fixture;
- operator/service instructions and rollback/recovery steps are updated; and
- no software test is treated as a substitute for physical braking, stability, force, EMC, cleanability, food/process, chemical, animal-welfare, or crop-protection validation.

### Minimum software acceptance matrix

| Capability | Acceptance test | Evidence |
| --- | --- | --- |
| Assembly/UCI | Valid module snaps and exports; invalid envelope, latch, connector, mass/CG, or capability is rejected with a reason | `VVT-VL-*` |
| Circuit/pin model | Duplicate/conflicting pins, voltage/current mismatch, and absent safety discrete are rejected; export matches controlled wiring | `VVT-EE-*` |
| Compiler | Valid recipe yields deterministic IR; unsafe loops, missing fault handler, unsupported action, stale state, unsigned artifact, or excessive limit is rejected | `VVT-DSL-*` |
| Simulation | Nominal, localization-loss, heartbeat-loss, module mismatch, tool timeout, and network-loss scenarios produce expected state/event traces | `VVT-SIM-*` |
| Edge execution | Signed approved artifact runs; wrong recipe/module/map/model/calibration or safety mode inhibits execution | `VVT-EXE-*` |
| Safety interface | E-stop/protective stop/latch/overspeed/heartbeat tests reach approved physical safe state with no auto-restart | `VVT-SAF-*` |
| OTA/config | Staged update, interrupted update, invalid signature, rollback, and audit retrieval succeed without loss of local-safe behavior | `VVT-CFG-*` |
| Feed/cleaning | Calibrated dose/flow/coverage, leak, cleanability, and no-double-dose behavior pass task criteria | `VVT-FD-*`, `VVT-CS-*` |
| Egg | Pick, force, crack, tray placement, traceability, materials, and process-owner review pass | `VVT-EG-*` |
| Weeding | Held-out data, calibration, latency, abstention, crop clearance, tool force, and guarded placement pass | `VVT-WD-*` |

## 7. First 30/60/90-day implementation backlog

### Days 0–30 — make the program buildable

- [ ] Complete the site-discovery questionnaire and name the first pilot farm, country, ODD, and two priority modules.
- [ ] Name systems, safety, farm-operations, agronomy, food/process, animal-welfare, cybersecurity, and verification owners.
- [ ] Create the requirements/traceability register and configuration-ID convention.
- [ ] Create the target repository directories, CI skeleton, code-review rules, artifact retention, and test-evidence template.
- [ ] Lock the initial domain schemas for AP-01, UCI-01, module manifests, zones, capabilities, recipes, events, and VVT evidence.
- [ ] Build the power/safety HIL panel design and order/bench long-lead safety, battery, wheel, compute, and connector candidates.
- [ ] Scaffold the Nuxt Virtual Lab, load a reference AP-01/UCI/FD-01 asset, and render coordinate frames.
- [ ] Add compiler tests for the existing four DSL examples and rejection fixtures.
- [ ] Agree the data/privacy/biosecurity protocol before farm image collection.

### Days 31–60 — prove interfaces before vehicle complexity

- [ ] Demonstrate UCI fit/manifest validation and export a canonical robot/module twin spec.
- [ ] Demonstrate recipe schema → semantic validation → deterministic IR → signed artifact.
- [ ] Stand up Gazebo route/dock/fault scenarios and replay event traces.
- [ ] Build and fault-inject the HIL safety chain: E-stop, latch, heartbeat, insulation/contactor, tool permit, and overspeed inputs.
- [ ] Bench one wheel module; capture torque, thermal, brake, steering, and encoder data.
- [ ] Close preliminary architecture/threat model review and prepare G1 evidence.
- [ ] Start the adjustable dummy cassette, feed meter, fluid bench, and egg/weed rigs.

### Days 61–90 — narrow risk and prepare G2/G3

- [ ] Freeze site/ODD assumptions or open an AP-02 decision; do not hide changed geometry in CAD.
- [ ] Release the CDR input set: CAD, FEA plan/results, electrical/wiring, P&ID, mass/CG, procurement and V&V plan.
- [ ] Bring the carrier mule up with wheels off the ground, then through the tethered bring-up ladder.
- [ ] Run UCI mis-seat/latch/connector tests on the 125 kg CG-adjustable dummy.
- [ ] Begin feed/cleaning calibration and create the first signed supervised recipe.
- [ ] Begin site data collection/annotation and weed perception in shadow mode; define crop thresholds before selecting an actuator action.
- [ ] Build the egg nest/effector test rig and decide the legally valid egg process with the qualified owner.

## 8. Risks, decisions, and stop conditions

| Risk / decision | Trigger | Required response |
| --- | --- | --- |
| AP-01 cannot fit both barn and field routes | Survey fails aisle/headland/track/grade limits | Retain UCI/electronics where useful; develop AP-02 running gear rather than distorting AP-01 or the crop. |
| White-paper web/AI scope is larger than the team | R0 vertical slice slips or core contracts change repeatedly | Freeze R0 to AP-01 + one benign cassette; defer advanced circuit editor, photorealism, RL, and swarm UI. |
| Safety controller or connector data is unavailable | Supplier cannot provide failure behavior, derating, lifecycle, or integration evidence | Do not release CDR; qualify an alternate or redesign the interface. |
| Perception performance drifts | Confidence, abstention, crop proximity, or false-action metrics leave approved bounds | Revert to shadow/sensing-only mode, preserve logs, retrain/recalibrate, and rerun the gate. |
| Egg/chemical process is not approved | No responsible process owner, SDS/label path, materials review, or waste route | Disable treatment/chemical action; continue collection, dry cleaning, or bench work only as approved. |
| Filled fluid/feed changes CG or stability | Weigh-in, slosh, brake, or tilt test leaves the approved envelope | Update manifest/limits and repeat stability/braking; do not simply lower a software speed without evidence. |
| OTA or fleet service fails | Interrupted/invalid update or lost link can alter execution or safe state | Roll back, disable rollout, preserve audit logs, and repair staging before pilot resumption. |
| Schedule pressure appears at a gate | A gate owner is asked to waive a safety/process/crop criterion | Stop the release. A passing module or attractive demo does not offset a failed gate. |

## 9. Governance and reporting

- **Weekly:** integration stand-up, open faults, test evidence, procurement blockers, and owner/date for every red item.
- **Biweekly:** configuration-control board for CAD, wiring, firmware, ROS packages, models, maps, recipes, safety fields, and chemistry.
- **At every gate:** independent review including the operator who will exchange, clean, charge, or recover the machine.
- **Release record:** requirement coverage, hazard disposition, configuration hashes, signed artifacts, open deviations, training status, rollback point, and explicit allowed zones/tasks.
- **Incident record:** immediately place the system in the required safe state, preserve logs, protect people/animals/environment, conduct operator and technical review, create corrective action, and rerun affected regression/physical tests before return.

The implementation is successful when the white paper's virtual-to-physical loop is reproducible, bounded, and auditable—not merely when a robot moves in a browser or a model performs well on a demonstration dataset.
