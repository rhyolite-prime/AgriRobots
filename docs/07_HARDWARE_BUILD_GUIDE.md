# 07 — Hardware build guidelines

**Document:** AGR-MFG-070 · **Revision:** A · **Status:** practical build guidance for the prototype phase
**Applies to:** AP-01 carrier prototype, UCI-01 interface, and the EG-01/FD-01/CS-01/WD-01 cassettes
**Companion documents:** [Design basis](00_DESIGN_BASIS.md) · [Mechanical design](01_MECHANICAL_DESIGN.md) · [Execution plan and V&V](03_EXECUTION_PLAN_AND_VV.md) · [Preliminary BOM](04_PRELIMINARY_BOM.md) · [Safety plan](05_SAFETY_AND_COMPLIANCE.md)

This document translates the concept package into workshop-level guidance: what to build first, how to assemble and wire it, how to bring it up safely, and what evidence to capture along the way. It is written for a small engineering team building **one supervised prototype** — it is not a production manufacturing instruction, and it does not replace the CDR-released fabrication drawings.

## 1. What must be true before you cut metal

The concept drawings and this package are explicitly **not for fabrication**. Do not order fabricated structure or commit the build until:

1. **Site discovery is closed** ([questionnaire](06_SITE_DISCOVERY_QUESTIONNAIRE.md), Gate G0): aisle widths, grades, floor/soil, nest/trough geometry, and the heaviest filled cassette mass are measured, not assumed. These decide wheel track, ground clearance, and the UCI load case.
2. **The safety concept is allocated** (Gate G1/PDR): every safety function SF-01…SF-08 has a named sensing/logic/output path and a required integrity target from the risk assessment.
3. **Detailed design is released** (Gate G2/CDR): parametric CAD, FEA on the frame and UCI, tolerance stack-ups, motor/brake/thermal sizing, battery protection scheme, P&ID for fluids, and a wiring/insulation plan — reviewed by qualified engineers. Build from those released drawings, not from the SVG concept sheets.
4. **Long-lead items are ordered or benched**: battery/BMS samples, wheel modules, safety controller and scanner, and compute are on the bench *before* the CAD freezes, so real connectors, masses, and pinouts drive the design.

If any of these are missing, spend the time on bench rigs and surveys (Section 4) — not on the frame.

## 2. Workshop, tooling, and test equipment

Reserve real space and budget for the items below; they are program assets, not accessories (see [BOM §7](04_PRELIMINARY_BOM.md)).

| Category | Minimum for the prototype phase |
| --- | --- |
| Fabrication | Weld station (or certified weld subcontractor for the frame), mill/drill or CNC access, bandsaw, press, tapping/insert tooling, torque tools with calibration certificates |
| Electrical | Insulated 48 V bench supply with current limit, bench electronic load, multimeters (CAT III rated for 48 V DC work), insulation tester, oscilloscope, crimp tooling *matched to the chosen contact family* with pull-test samples |
| Test & measurement | Platform scale (≥500 kg, for the weigh-in of every build), load cells, stop-distance measurement (tape + markers or optical), inclinometer, pressure/flow meters for fluid benches, calibration targets for cameras |
| Safety infrastructure | Lockout/tagout kit and tagged isolation points, insulated gloves and eye protection for battery work, ABC fire extinguishers plus a **Class D / lithium-appropriate plan**, fenced or taped test area with controlled access, e-stop pendant on a trailing cable for early mule runs |
| Fixtures (make these first) | Battery service tray, 125 kg CG-adjustable **dummy cassette**, cassette exchange dolly/lifting fixture, wheel-module bench rig, HIL bench panel |
| Data/IT | Firmware flashing fixtures, USB-CAN/Ethernet analyzers, network switch for the bench, NTP/PTP time source, logging storage |

## 3. Golden rules for the whole build

1. **Safety hardware is not prototyped with hobby parts.** The safety controller, e-stops, scanner, and brakes are bought, certified components integrated per their manuals. Budget pressure is applied elsewhere (see [BOM §2](04_PRELIMINARY_BOM.md)).
2. **Every moving prototype test has an independent stop path.** From the first wheel spin to the final pilot: trailing e-stop + fenced area until the on-board safety chain is proven; on-board safety chain afterward.
3. **Measure, don't assume.** Torque, thermal, traction, stop distance, connector temperature rise, and CG are measured on the real build at the real loads. Catalogue values are sizing inputs only.
4. **Weigh and CG everything.** Each subsystem is weighed and its CG recorded before integration; the vehicle is weighed empty, with the dummy cassette, and at worst approved CG. The mass database feeds the stability case (SYS-003).
5. **Serials and records from day one.** Every harness, board, wheel module, and cassette gets a serial number and a build record; every test gets a `VVT-*` evidence entry. Retrofitting traceability later does not work.
6. **No energized mechanical work.** Guard removal, jam clearance, and latch service happen in LOTO/service mode only, per the operating modes in [Safety plan §5](05_SAFETY_AND_COMPLIANCE.md).
7. **One integration change at a time.** When bringing up the mule, change one thing (firmware, wiring, gain, route) between tests so any behavior change has a known cause.

## 4. Build sequence overview

Build **benches and the mule before autonomy, and the carrier before any cassette** — matching the work breakdown and gates in the [execution plan](03_EXECUTION_PLAN_AND_VV.md):

| Phase | What you build | Exit evidence (gate) |
| --- | --- | --- |
| 0. Bench rigs | Power/safety HIL bench; wheel-module bench; dummy cassette; task benches (feed metering, egg effector, fluid) | Fault-injection tests pass on the bench before they are needed on the vehicle (WP1–WP2) |
| 1. Carrier mule | Frame, wheel modules, steering, brakes, battery, contactors, safety controller — **no autonomy compute** | G3: e-stop, bumper/lidar, overspeed, heartbeat, stop-distance, mode transitions pass in a controlled area |
| 2. UCI-01 | Rails, locators, latches, keyed connector, ID sensing; 125 kg dummy cassette | G4: 100-cycle exchange, mis-seat/lock fault cases, connector thermal, worst-CG stability |
| 3. Autonomy stack | Compute, network, GNSS/IMU, cameras, mast integration; teleop → mapping → Nav2 | Teleop, record/replay, localization-loss degradation tests (WP3) |
| 4. Benign cassettes | FD-01 and CS-01 (bench-proven modules mounted on the carrier) | G5: dose/flow targets, no uncontrolled spill |
| 5. High-consequence cassettes | EG-01, then WD-01 — only after their process/safety gates | G6/G7: pick/crack/traceability; crop-protection and placement evidence |
| 6. Integration pilot | Full vehicle, trained operators, supervised routes | G8 readiness review |

The phases deliberately overlap in calendar time (e.g., WD-01 dataset work starts at week 12), but **vehicle integration order is strict**: nothing rides on the carrier until the carrier's own gate has passed.

## 5. Phase 0 — Bench rigs before the vehicle

Build and prove these on the bench; every one of them removes a risk that is expensive to debug on a moving 330 kg machine:

- **Power/safety HIL bench.** The real battery (or a current-limited 48 V supply), contactors, pre-charge, fuses, service disconnect, DC/DC, and the safety controller on a panel, with fault injectors (open e-stop channel, missing heartbeat, latch open, insulation fault). Prove the safe state first: *with everything wired but nothing else connected, the bench must fail to everything-off under each injected fault.* This is the template for the vehicle panel.
- **Wheel-module bench.** One wheel module with its drive, brake, and encoder on a dynamometer or brake-loaded rig. Capture torque vs current, thermal curves at continuous load, brake engage/release time and holding torque, and encoder plausibility behavior. These curves feed the safety controller's overspeed/stop-distance budget — do not take them from a datasheet.
- **Dummy cassette.** A rigid weldment at the UCI footprint with bolt-on ballast and an adjustable CG bracket up to 125 kg. This is the only payload allowed until G4 passes; use it for every interchange, retention, and stability test.
- **Task benches.** Feed metering bench (hopper + auger + load cell, calibrated per feed type), egg end-effector rig (force-mapped on representative shells, not glass marbles), fluid bench (pump/nozzle/flow at target pressure, with containment), camera/calibration rig for WD-01. Each bench produces its calibration curves *before* vehicle integration.

## 6. Phase 1 — Building the carrier mule

### 6.1 Frame and structure

- Fabricate the ladder frame to the released drawings: welded 6061-T6 or coated steel as selected at CDR. If aluminum, use certified welders and weld-procedure/inspection records; galvanic isolation (isolating bushes, coated fasteners) wherever dissimilar metals meet.
- **Jig the frame.** Weld in a fixture that establishes the datum features — cassette support plane (datum A), longitudinal centre plane (B), forward face (C) — and verify the welded result against them before any subassembly is mounted.
- Keep the **battery tray below the cassette plane** and inside the wheel rectangle; design the retention to survive the crash/rollover load case from the structural analysis, not just 1 g.
- Build in service access now: battery drop-out path, contactor panel access, brake service access per wheel, and cable routing channels with strain relief. Anything that can only be reached by removing the frame later will never be inspected.
- Corrosion: include material test coupons in the fabrication run, especially if the frame will see washdown or agrichemical exposure.

### 6.2 Wheel modules, steering, brakes

- Mount each **benched** wheel module (Phase 0) to the frame with serviceable fasteners; no welded-in motors. Each module keeps its own brake, encoder, and connector so a module can be swapped in minutes.
- Steering actuators get **mechanical end stops** in addition to software limits, plus a calibrated absolute angle reference per corner. Verify 4WS counter-phase and crab modes at low speed with the safety speed cap active.
- Set the brake state assumption from day one: **brakes on by default, energy to release** (or spring-applied equivalents), so every power-up fault parks the vehicle. Confirm holding on the maximum approved grade with the dummy cassette at worst CG — measured, on the actual surface, with worn-tyre allowance.

### 6.3 Power system (48 V)

Wire in this order, and do not connect the battery until the chain below is proven on the bench:

1. **Service disconnect** in an accessible, lockable position — the LOTO point for all mechanical work.
2. **Main fuse** sized to the harness protection study, then **pre-charge circuit** and **main contactor**, both commanded by the safety controller only.
3. **Insulation monitoring / ground-fault detection** appropriate to an IT-style 48 V DC system, and BMS status wired to the safety controller (SF-07).
4. **DC/DC to 24 V** for controls/valves/lighting, each branch fused and current-monitored.
5. **Auxiliary 48 V feed to the UCI connector** through its own fuse + contactor, dead unless latch-closed and safety-permit are valid (SF-04/SF-05).

Harness discipline: HV/LV separation and spacing per the electrical plan; single-point bonding scheme documented; every conductor labeled at both ends against the released wiring diagram; connectors rated and *derated* for the actual current and temperature (measure connector temperature rise under continuous load at G4); drip loops and glands oriented so washdown water runs away from contacts.

### 6.4 Safety controller and stop chain

- Integrate the safety controller per its manual: dual-channel e-stops (vehicle-mounted, plus any area/remote stops the risk assessment requires), safety scanner(s), bumper strip, tilt/IMU plausibility, and drive enable outputs.
- The safety controller's outputs remove **traction enable and tool energy** through contactors/brakes — a path that shares nothing with the autonomy computer (design rule, [Safety plan §2](05_SAFETY_AND_COMPLIANCE.md)).
- Configure and **document** protective fields per zone/mode; sizes come from measured stop distance at the approved speed/load/surface, with margin — never from a default scanning-field drawing.
- Prove the stop chain with fault injection before the wheels ever touch ground under power: open each e-stop channel, unplug the scanner, cut the heartbeat, force overspeed, force tilt, unlatch — each must produce the defined safe state, and none may auto-restart.

### 6.5 Mule bring-up ladder

Never skip a rung; each rung has a pass criterion recorded as `VVT-SAF-*` evidence:

| Rung | Configuration | Pass criterion |
| --- | --- | --- |
| 1. Wheels off ground | Vehicle on stands, battery in, safety chain live | All commands act; every injected fault removes drive/brakes on; no unexpected motion |
| 2. Tethered, brakes-only | Trailing e-stop + kill cord, vehicle on ground, fenced area, safety cap at low speed | Controlled drive/steer; e-stop and bumper stops within budget on the actual floor |
| 3. Tethered, full mule | Add speed steps toward the 1.5 m/s cap | Stop distance measured at each speed/load/surface; fields resized from data |
| 4. Radio teleop | Handheld controller with its own stop; supervisor with line of sight | Loss-of-link behaves as designed (timed stop); no restart without local action |
| 5. Supervised autonomy | Compute installed, teleop retained as fallback | Route repeatability, localization-loss degradation, docking approach — per WP3 |

## 7. Phase 2 — UCI-01 cassette interface

- Fabricate rails and wear pads to the released UCI drawings; the four replaceable pads are sacrificial service parts — never let wear reach the structural datum.
- Fit the 3-2-1 locating scheme (two tapered primaries, one lateral, one vertical clamp) and the four captive M12 clamps with closed/locked sensing on each.
- Wire the keyed power/data receptacle with its pre-charge/fuse/contactor chain and latch interlocks; mount the ID/authentication element (memory chip or coded pin block) and prove the cross-check against the manifest (SYS-005).
- Run the G4 campaign with the dummy cassette: **100 exchange cycles** recording latch sensor behavior, clamp torque, connector mating force; then mis-seat tests (one locator missing, one clamp open, connector unlocked) — motion and tool enable must be impossible in every case.
- Measure connector temperature rise at 50 A continuous / 75 A peak through the actual harness, and re-verify after the 100 cycles (contact wear changes resistance).
- Prove worst-case stability: dummy cassette ballasted to 125 kg at the highest CG the manifest will allow, static tilt and braking tests at the defined limits.

## 8. Phase 3 — Compute, network, and sensors

- Mount the autonomy computer and network in a **sealed pod close to the vehicle centre**, not on the mast; only sensors and minimal junction boxes go high. Mast mass is budgeted in the CG table — weigh the installed mast and update the mass database.
- Follow the [controls architecture](02_CONTROLS_SOFTWARE_AND_DSL.md): safety signals stay hardwired/safety-rated; ROS 2 DDS traffic never carries a sole protective function; EtherCAT/CAN-FD for motion; PTP or hardware timestamping where the perception error budget needs it.
- Protect sightlines: wash shields and lens access for every camera and scanner, verified *with each cassette installed* (cassette structures can occlude fields — re-verify, don't assume).
- Bring-up discipline: each sensor gets a health/quality topic and a daily-check item; time sync, extrinsic calibration values, and firmware versions are recorded in the configuration manifest so every log is interpretable months later.

## 9. Phases 4–5 — Cassettes: bench first, vehicle second

Each cassette follows the same pattern, regardless of task:

1. **Bench module first** (Phase 0 benches): prove the task physics — dosing accuracy, pick forces, flow/pressure, tool placement — with calibration records, before anything is mounted on the carrier.
2. **Build the cassette structure** to the UCI contract: flat drainable underside, keyed footprint, mass/CG inside its declared manifest envelope, cleanable materials with no product traps in the feed/egg path.
3. **Integrate the cassette controller** (dedicated MCU with watchdog), the ID/manifest, latch/lock sensing, and the safe-enable input that removes tool energy through the carrier's safety chain.
4. **Ground-vehicle tests in guarded area first** — for tools with any hazard (auger, arm, stage, nozzles): guarded lane, supervisor with stop authority, tool force/pressure limits proven on fixtures before live targets.
5. **Task-specific gates** are not interchangeable: FD-01/CS-01 pass G5 targets; EG-01 additionally needs the food-contact material and process-owner review (G6); WD-01 stays sensing-only until crop-protection, latency, and placement evidence passes G7 — *no gate is waived because another module works*.

Specific cautions carried over from the mechanical design: guard the FD-01 auger and clear jams only under LOTO; CS-01 fluid seals/tubing must match the approved chemical (compatibility table released before procurement), with containment and leak sensing tested before first fill; WD-01's exclusion radius, confidence gates, and parking position are safety configuration, not tuning parameters.

## 10. Documentation and configuration control during the build

- **As-built records**: each subsystem gets a build sheet — serials, torque values, firmware versions, harness checks (continuity + insulation), and the weigh-in entry. The released drawing set is updated to as-built at each gate.
- **Evidence discipline**: every test writes a `VVT-*` record with configuration IDs (`AP01-Rx`, `EG01-Rx`, recipe hash), setup, result, and pass/fail against the named criterion ([V&V matrix](03_EXECUTION_PLAN_AND_VV.md)). A demo video is not evidence.
- **Change control**: after G2, changes to structure, braking, safety fields, UCI geometry, fluids, or mass/CG go through the configuration-control board and trigger re-verification of the affected tests (SYS-010). Keep a visible "config frozen for test X" state during test campaigns.
- **Repository layout** from day one: `cad/`, `firmware/`, `ros_ws/`, `simulation/`, `recipes/`, `test_evidence/` — with signed release manifests, as required by the execution plan.

## 11. Common pitfalls to design against

| Pitfall | Consequence | Countermeasure |
| --- | --- | --- |
| Building the frame before the site survey closes | Chassis that cannot enter the aisle or straddle the bed | G0 before fabrication; geometry assumptions A-01…A-08 frozen |
| Autonomy-first bring-up ("it's easier to test with Nav2 running") | Stop-chain faults masked by software; unexplainable near-misses | Mule passes G3 with **no** autonomy compute installed |
| Hobby-grade motors/brakes with no torque/thermal data | Undersized brakes, thermal fades mid-run, opaque failure modes | Buy wheel modules with test data; bench-verify anyway (Phase 0) |
| Connector selected by catalogue current only | Overheating/arc at the UCI after wear | Thermal-rise test at G4 with derating margin |
| Ignoring CG until the first tip scare | Cassette designs drift outside the stability envelope | Weigh + CG every subsystem; dummy-cassette worst-CG tests |
| One person's head contains the wiring | Unmaintainable, unverifiable machine | Labeled both ends, released diagrams, as-built records |
| Unlabeled/undocumented test configs | Evidence that cannot be reproduced | Config ID in every `VVT` record; frozen configs per campaign |
| Skipping rungs of the bring-up ladder | First fault discovered with wheels down and people near | The ladder in §6.5 is mandatory; each rung's evidence is a gate |
| Prototyping the safety chain with relay-logic improvisation | No integrity claim, impossible to validate | Certified safety components wired per manual; fault-injection records |
| Letting schedule pressure waive a cassette gate | The one module that hurts someone/something is the one that skipped | Gate owner authority; safety/process gates are not tradeable |

## 12. Quick-reference build checklist

- [ ] Site survey closed; ODD and mass/CG assumptions frozen (G0/G1)
- [ ] CDR released: CAD, FEA, wiring, P&ID, test plan (G2)
- [ ] Workshop, fixtures, LOTO, and test equipment in place (§2)
- [ ] HIL power/safety bench passes fault injection (§5, Phase 0)
- [ ] Wheel modules benched: torque, thermal, brake, encoder data captured
- [ ] Frame fabricated in jig; datums verified; weigh-in recorded
- [ ] Power chain wired and insulation/ground-fault scheme proven
- [ ] Safety stop chain proven by fault injection (wheels off ground)
- [ ] Bring-up ladder rungs 1–5 passed with recorded stop distances (G3)
- [ ] UCI built; 100-cycle + mis-seat + connector thermal + worst-CG tests passed (G4)
- [ ] Compute/network/sensors installed; sightlines verified per cassette
- [ ] Dummy cassette only payload until G4; cassettes bench-proven before mounting
- [ ] Each cassette gate passed in order (G5 → G6 → G7) before its pilot
- [ ] As-built docs, `VVT-*` evidence, and configuration control current at every gate
