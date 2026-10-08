# 03 — Project execution plan and verification & validation

**Document:** AGR-PRO-030 · **Revision:** A · **Planning horizon:** 52 weeks after pilot site selection
**Plan type:** Staged engineering program. Duration assumes parallel mechanical, software, and farm-operations workstreams and a named pilot customer.

## 1. Program principles

- Build the **safety carrier first**, then prove one cassette at a time. A vision demo does not validate a mobile chemical tool; a working feeder does not validate egg food handling.
- Freeze the operating design domain before scaling. Each task/cassette has its own safety case, FMEA, test report, and operating procedure.
- Treat every target metric as a hypothesis until measured at the selected farm/crop.
- Use simulation/replay to find regressions early; use physical safety tests to establish stopping, forces, stability, environmental robustness, and ergonomics.
- The gate owner can stop a release. A schedule delay is safer/cheaper than bypassing a safety or food-process gate.

## 2. Work breakdown structure

| WP | Weeks | Lead disciplines | Outputs / exit evidence |
| --- | ---:| --- | --- |
| WP0 — Pilot discovery & requirements | 0–4 | Product, farm ops, safety, agronomy, food/process | Completed site questionnaire, route/crop/nest survey, user stories, legal/process register, ODD v1, named pilot modules |
| WP1 — Safety concept & system architecture | 2–8 | Safety, systems, electrical, software | Preliminary hazard analysis, safety function allocation, architecture, data/cyber plan, requirement traceability, PDR package |
| WP2 — Carrier detailed design & mule | 5–16 | Mechanical, EE, embedded, test | CAD/FEA, wiring/P&ID, procurement, non-autonomous mule, HIL bench, DVT plan; CDR approval before production parts |
| WP3 — Core autonomy & digital twin | 6–20 | Robotics, embedded, DevOps | ROS 2 baseline, URDF/simulation, teleop, mapping/localization, Nav2, recorder/replay, safety bridge, signed configuration |
| WP4 — UCI-01 / docking / energy | 10–20 | Mechanical, EE, test | 100-cycle cassette interface test, connector thermal test, latch/ID interlocks, charge/dock prototype, service fixture |
| WP5 — Feed and cleaning cassettes | 12–26 | Mechanical, process, embedded, farm ops | FD-01 and CS-01 prototypes, material/cleanability review, dose/flow calibration, guarded trials and SOPs |
| WP6 — Egg collection cassette | 14–30 | Mechatronics, perception, food/process, animal welfare | EG-01 prototype, nest/egg test rig, gentle-pick evidence, traceability, treatment process decision and approval |
| WP7 — Weed perception and tool | 12–38 | Agronomy, CV/ML, mechatronics, safety | Dataset + label guide, calibration rig, shadow mode, WD-01 guarded tool pilot, crop-protection evidence |
| WP8 — System integration & pre-compliance | 24–44 | Systems, safety, QA, test | Requirement coverage, fault injection, EMC pre-scan, stability/braking, environmental/cleanability trials, operator training |
| WP9 — Supervised farm pilot | 40–52 | Farm ops, support, QA, robotics | Pilot logs, KPI review, incidents/near misses, service report, acceptance/release recommendation |

## 3. Gate plan

| Gate | Target week | Entry criteria | Exit / no-go criteria |
| --- | ---:| --- | --- |
| G0 — Problem/site fit | 4 | Pilot farm engaged; four use cases requested | ODD, site map, routes, local regulatory owner, first two module priorities and business KPI signed |
| G1 — PDR | 8 | Requirements and preliminary hazards drafted | Safety allocation and architecture reviewed; no unresolved fundamental geometry/process conflict |
| G2 — Carrier CDR | 12 | CAD, loads, electrical/safety concept, supply plan | Independent design review signs drawings/analysis/test plan; long-leads released only after approval |
| G3 — Safety mule | 18 | Carrier assembled, HIL/safety bench available | E-stop, brake, bumper/lidar, overspeed, heartbeat, stop-distance and mode-transition tests pass in controlled area |
| G4 — Cassette interface | 20 | UCI and representative mass dummy available | 100 exchanges, lock/ID fault cases, connector thermal/derating and worst-CG stability pass |
| G5 — Benign task pilots | 28 | FD/CS prototype, SOPs, guarded environment | Feed mass/flow and cleaning application/recovery meet defined targets; no uncontrolled spill or unsafe interaction |
| G6 — Egg readiness | 32 | EG prototype + process owner | Pick/crack/traceability targets pass on representative test; any egg sanitation process has explicit approval/validation |
| G7 — Weed guarded release | 38 | WD dataset/model/tool evidence, restricted plot | Held-out metrics + shadow data + crop-protection and tool-force tests pass. Otherwise remain sensing-only. |
| G8 — Farm-pilot readiness | 44 | Training, maintenance, incident, cyber/update, spare, and rescue procedures ready | Independent safety/process review authorizes a limited supervised pilot; all critical hazards closed or formally accepted |
| G9 — Pilot review | 52 | Minimum agreed operating hours/data volume collected | KPI, incidents, economics and maintainability reviewed; decide iterate, extend, or release a controlled production design |

## 4. First 90 days: practical backlog

### Days 0–30 — make the unknowns visible

1. Walk every intended indoor route and field route with measurements: width at 50 mm height increments, doorway/threshold/grade, drain, water, lighting, Wi-Fi, dust, animal barriers, escape path.
2. Survey every nest, tray, trough, refill point, clean-in-place point, drain/disposal point, crop bed, row, headland and docking location.
3. Capture representative eggs, feed, waste, weeds and seedlings only with farm consent and biosecurity protocol. Establish baseline human task times and errors.
4. Hold a hazard workshop with operators, veterinarian/animal-welfare lead, agronomist, food/process lead, safety engineer and maintenance technician.
5. Freeze AP-01 revisions A assumptions or formally decide to develop AP-02 field undercarriage.

### Days 31–60 — prove the safety and integration backbone

1. Build a stationary power/safety HIL rig: contactors, E-stop chains, brake/tool outputs, latch/ID simulation, safety scanner interface and fault injectors.
2. Start the carrier rolling mule under tethered/manual control in a fenced test area. Measure torque/thermal/traction/steer/stopping behavior rather than extrapolating catalogue values.
3. Stand up repository standards: `requirements/`, `cad/`, `firmware/`, `ros_ws/`, `simulation/`, `recipes/`, `test_evidence/`, signed release manifest, code review and change control.
4. Use URDF + Gazebo map of pilot corridors. Validate teleop, time sync, recording/replay, remote HMI and recovery procedure.

### Days 61–90 — narrow task risk

1. Test UCI repeated docking/latching with a 125 kg CG-adjustable dummy cassette; test mis-seat, open latch, connector pull, power brownout, and contamination.
2. Build the feeder metering bench and cleaning fluid bench; obtain calibration curves by feed and nozzles before mounting them to a moving base.
3. Start weed data collection/annotation and run perception in shadow mode. Define crop safety thresholds *before* adding an actuator.
4. Build the egg end-effector/nest test rig, force-map representative shells, and decide the legally valid sanitation process with a qualified food/process owner.

## 5. Verification matrix (minimum evidence)

| Area | Test / analysis | Pass criterion before next gate | Evidence ID convention |
| --- | --- | --- | --- |
| Structure | Static load, fatigue/vibration, FEA correlation | Meets reviewed factor/deflection/fatigue limits at worst approved mass/CG | `VVT-STR-*` |
| Stability | Static tilt, braking, turning, grade, slosh | Stable and controllable at defined ODD and mass/CG; no unbounded load shift | `VVT-STB-*` |
| Safety stop | E-stop, lidar field, bumper, heartbeat, overspeed, fault injection | Physical outputs reach approved safe state within allocated reaction/stop distance | `VVT-SAF-*` |
| UCI | Fit, 100-cycle latch, connector heat, misconfiguration | Cannot enable motion/tool with unsafe/unrecognized/partially seated module | `VVT-UCI-*` |
| Navigation | Route, dock, localization loss, map mismatch | Meets ODD-specific accuracy and safe degradation policy | `VVT-NAV-*` |
| Feed | Mass accuracy across feed/temperature/tilt | Meets calibrated target; out-of-tolerance event cannot silently redose | `VVT-FD-*` |
| Sanitation | Flow, pressure, coverage, dwell, leakage, cleanability | Meets validated process and waste route; chemical compatibility documented | `VVT-CS-*` |
| Egg | End-effector force, pick, crack, tray placement, cleaning | Meets pilot target and food/process owner acceptance; not an unvalidated shell-treatment claim | `VVT-EG-*` |
| Weeding | Dataset split, calibration, latency, shadow, crop-proximity, tool force | Crop-protection gates and placement accuracy met on held-out/guarded test data | `VVT-WD-*` |
| Cyber/config | Signature, rollback, auth, logging, update failure | Only approved artifacts run; audit record is complete and readable | `VVT-CFG-*` |

A requirement has a unique ID, a verification method, a test owner, versioned evidence, result, and disposition. A slide/video alone is not test evidence.

## 6. Pilot acceptance criteria

The pilot begins with **supervised operations only**, on named routes and time windows. Success should be defined jointly with the pilot farm before G0; a reasonable starting scorecard is:

| KPI | Proposed first-pilot threshold |
| --- | --- |
| Safety | Zero unreviewed safety stops/contact events; all events logged and triaged before resume |
| Availability | ≥80% scheduled supervised task availability excluding planned trials/changes; track each downtime cause |
| Egg collection | ≥95% accessible-egg pick success; <1% new handling-attributable crack rate in statistically agreed sample |
| Feed | ±5% dose at approved station/feed calibration and no uncontrolled release/spill |
| Cleaning | Delivered dose/coverage/dwell matches validated process record; no chemical leak or prohibited discharge |
| Weeding | No crop action outside approved crop-protection threshold; operate sensing-only if that threshold is not demonstrated |
| Service | Cassette exchange, daily inspection, charge/refill, washdown and recovery can be completed by trained staff using the documented SOP |

Do not aggregate these into a single percentage. A feed pass does not offset a safety failure or crop damage.

## 7. Top project risks and mitigations

| Risk | Why it matters | Early mitigation / decision trigger |
| --- | --- | --- |
| One chassis does not fit both barn and crop geometry | Basic width/clearance conflict cannot be solved in software | Survey first; retain common interface but release AP-02 running gear if needed |
| Young-crop model fails under soil/light/cultivar drift | Crop loss and loss of trust | Dataset diversity, calibration board, confidence abstention, shadow mode, guarded plots; never force actuation rate |
| Chemical/egg process noncompliance | Food/worker/environmental harm and legal exposure | Separate process owner; approve chemistry/material/waste route; default to no shell treatment |
| Animal behavior reacts badly to robot | Welfare, injury, reduced productivity | Low-speed habituation, sound/light constraints, escape paths, welfare observations, supervisor stop authority |
| Sensor contamination / washdown damage | Localization/safety/perception degradation | Shield/cleaning access, health diagnostics, redundant safety sensing where risk assessment requires, daily checklist |
| Filled-fluid CG / slosh changes stability | Tip or brake performance | Baffled tank, manifest mass states, worst-case stability/braking tests, speed derating |
| Cassette connector/latch wear | Drop/arc/unexpected reset | Manual UCI test campaign, condition sensing, service limits, no live disconnect |
| Long lead safety / compute components | Schedule and redesign risk | Dual-source architecture, early procurement, bench interfaces, component lifecycle review |
| Cyber/OTA failure | Loss of control or untraceable behavior | Signed immutable releases, local-safe architecture, staged updates/rollback, access control |

## 8. Team and governance

Minimum named roles: product owner; farm operations owner; systems lead; functional-safety engineer; mechanical lead; electrical/embedded lead; robotics lead; CV/ML + agronomy lead; food/process or chemical lead; animal-welfare lead; verification lead; field service lead; cybersecurity owner.

- Weekly: integration/test triage with blocker ownership.
- Biweekly: configuration-control board for CAD, firmware, ROS, model, recipe, map and chemical changes.
- At each gate: independent review including the farm operator who will use and clean the machine.
- Incident protocol: immediate safe state, preserve logs, operator/debrief, corrective-action record, regression test before return.
