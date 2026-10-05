# 05 — Safety, food, chemical, and compliance plan

**Document:** AGR-SAF-050 · **Revision:** A · **Status:** safety planning aid; not a certification or legal opinion

## 1. Safety position

This concept must not enter normal farm service on the strength of CAD, a ROS package, or a prototype demonstration. A qualified machine-safety engineer and the target-market responsible person must lead the formal risk assessment, safety requirements, validation, technical file and operator instructions.

The relevant standard set depends on machine classification, country, task, and whether it operates around people/animals/food/chemicals. Treat the following as a **starting map**, confirm current editions/local adoption, and obtain the standards:

| Topic | Starting reference | How it is used here |
| --- | --- | --- |
| General machinery risk assessment | ISO 12100 | Hazard identification, inherently safe design, safeguarding, information for use |
| Safety-related controls | ISO 13849-1/-2; agricultural ISO 25119 series; IEC 61508 as applicable | Allocate functions and determine required PL/AgPL/SIL, architecture, validation and lifecycle evidence |
| Driverless mobile systems | ISO 3691-4:2023, where applicable; local mobile robot/vehicle law | Starting point for braking, detection, mode control and system integration; agricultural use may need additional analysis |
| Electrical equipment | IEC 60204-1; local low-voltage/EMC/battery law | Isolation, wiring, bonding, emergency stop, documentation and verification |
| Guards/interlocks | ISO 14120, ISO 14119, ISO 13850 | Tool guards, interlocked access, emergency stop and defeat-resistance |
| Cybersecurity | IEC 62443 concepts + local privacy/cyber law | Asset inventory, identity, secure update, network segmentation, access and incident response |
| Food/feed/egg process | Applicable national food hygiene, egg marketing/washing, feed hygiene, veterinary/biosecurity rules | Governs shell treatment, materials, traceability, water/chemical use and sanitation—not ROS |
| Chemical use/waste | Product label/SDS, local pesticide/biocide, occupational safety and environmental rules | Approves chemistry, concentrations, worker PPE, drift control, storage, recovery and disposal |

ISO describes the ISO 25119 series as safety-related control-system principles for agricultural/forestry equipment ([ISO overview](https://www.iso.org/news/ref2343.html)). ISO 3691-4:2023 is a published driverless industrial-truck safety standard ([listing](https://standards.iteh.ai/catalog/standards/iso/2cf9507f-cfed-48c7-9e3a-e1490b9da818/iso-3691-4-2023)); a farm machine may not fall cleanly in its scope, so it is a useful reference—not an automatic compliance path.

## 2. Safety function concept

Final integrity requirements are risk-assessment outputs. The table provides a **functional allocation**, not a claimed PL/AgPL.

| ID | Safety function | Initiators / inputs | Independent final element | Safe state / proof required |
| --- | --- | --- | --- | --- |
| SF-01 | Emergency stop | Dual-channel local e-stops and approved remote/area system where justified | Safety controller opens traction/tool enable, commands brake | No hazardous movement/tool energy; reset requires inspection and deliberate sequence |
| SF-02 | Person/animal protective stop | Safety-rated scanner(s), bumper/contact sensor and route policy | Safety controller / safe drive torque off | Stop before contact within validated field and stopping distance for approved speed/load/ground |
| SF-03 | Overspeed / unintended motion | Encoder plausibility, drive feedback, safety controller | Safe torque removal + brake | Speed is capped by mode/cassette/zone; abnormal motion stops |
| SF-04 | Module retention/identity | Latch closed sensors, connector lock, physical ID/manifest cross-check | Travel/tool enable interlock | Cannot enable if unlatched, unknown, out-of-envelope or configuration mismatch |
| SF-05 | Tool hazard enable | Guard/park sensor, pressure/force/valve feedback, safety zone/mode | Monitored safe valve/contactor/drive enable | Tools parked/de-energized outside approved task zone or on fault |
| SF-06 | Stability/tilt | IMU/tilt, load mass/CG manifest, speed/steering state | Safety speed limitation/stop | Stop or limit before operating beyond validated slope/CG envelope |
| SF-07 | Electrical energy isolation | Service disconnect, insulation/ground fault/thermal/BMS status | Contactors/fuses and lockout point | Isolate high energy; no restart until fault/PPE procedure complete |
| SF-08 | Controlled communication loss | Hardware heartbeat/timeout between autonomy, motion and tool controllers | Base/tool MCU safe state; safety controller persists | Zero command / tool park / brake according to allocated timeout |

### Non-negotiable design rules

1. The safety path uses independent sensing/logic/output appropriate to its claimed integrity. ROS topics, Wi-Fi, a GPU detector, and a single Linux process are not sufficient as the only safety channel.
2. No cassette may energize, dispense, or actuate just because an Ethernet command arrived. It requires physical latch, correct mode, safety permit and local controller confirmation.
3. No automatic restart after protective stop. The conditions and reset location must prevent a person being exposed during restart.
4. Safety field sizing, braking, speed and stopping distance use the loaded vehicle, worst approved CG, worn tyres, actual floor/soil, gradient and measured reaction chain.
5. A safety feature that is dirty, bypassed, masked, or unavailable removes the robot from the affected operating mode. “Keep running carefully” is not a fault response.

## 3. Preliminary hazard register

| Hazard / exposure | Example cause | Required design / operational controls |
| --- | --- | --- |
| Crush/impact/run-over | Blind corner, sensor obscured, animal/person crosses path, brake defect | Commissioned routes, protective fields, speed zones, bumpers, warning signals, measured stop performance, refuge/escape, daily checks |
| Pinch/shear/entanglement | Wheel, arm, auger, scraper, XY stage | Physical guards, safe distances, interlocks, limited force, stored-energy release, lockout/tagout and service mode |
| Tip/roll or dropped cassette | High CG tank/arm, slope, latch error, turning | Mass/CG manifest, baffling, stability test, speed/steer limits, four-lock retention, hardpoints/dolly procedure |
| Electrical arc/shock/fire | Damaged harness, water ingress, battery abuse | Correct protection/bonding, service isolation, IP/cleaning design, thermal monitoring, cable protection, battery incident plan |
| Chemical exposure/drift | Wrong chemical, leaky line, nozzle clog/unintended spray | Approved SDS/label only, keyed filling, containment, low drift, leak detection, PPE, stop zones, recovery/disposal procedure |
| Food/feed contamination | Poor cleanability, cross-use of dirty module, wrong material | Segregated modules/tools, approved contact materials, cleaning validation, traceability, dedicated storage and inspection |
| Egg breakage / welfare | Excess gripper force, alarming lights/noise, unpredictable robot | Compliance/end-effector limits, audio/lighting limits, welfare observation, slow habituation, stop authority |
| Crop damage | Misclassification, latency, calibration drift, mechanism rebound | Conservative abstention, crop exclusion radius, hard guarded trials, crop-specific model/calibration, audit imagery |
| Unintended cyber/control change | Shared password, unsigned update, remote access | Unique IDs/RBAC, signed artifacts, VPN, change control, logging, local safe behavior on network loss |
| Biological exposure / biosecurity | Movement between houses/plots, waste handling | Site biosecurity plan, washdown/disinfection boundaries, route segregation, PPE and cleaning records |

## 4. Food, eggs, feed, and sanitation constraints

### Egg collection

- Separate **egg collection** from **egg-shell sanitation/treatment** in the requirements, physical architecture, risk assessment and process validation.
- Use materials and cleaning procedures appropriate to food-contact parts where they touch eggs/trays; define a dedicated clean/dirty workflow.
- A shell crack, dirty egg, abnormal shape, or vacuum failure must result in a segregated tray/event—not blind re-gripping or mixing it into a clean batch.
- Any use of water, detergents, sanitizers, UV-C, heat, or coatings must be selected/validated by the responsible food/process authority for the target country and egg chain. The mechanical design reserves space but does not pre-approve a method.

### Feed

- Feed dose accuracy requires a calibration curve by lot/formulation, moisture, particle size and hopper orientation. Refill and clean-out procedures must prevent mould, bridging and cross-contamination.
- Guard the auger/rotary valve. Operators clear jams only in lockout/tagout/service procedure—never while energized.
- Feed must not be metered automatically twice to correct a missing measurement. Flag, quarantine the dose decision, and involve the stockperson.

### Cleaning and sanitation

- Start with task classification: dry removal, detergent clean, rinse, disinfectant application, dwell, rinse/recovery, and release-to-occupancy. “Sanitize” without a target organism, surface, concentration, dwell time and verification method is not a specification.
- Chemical labels and SDS set compatibility, dilution, storage, PPE, ventilation and waste obligations. The robot must record lot, dilution, delivered volume, pressure, time, zone and operator approval.
- Keep low-pressure application as the baseline; high pressure adds aerosol, animal, operator, water-intrusion and waste hazards and is a separate design/safety decision.

## 5. Operating modes and procedures

| Mode | Who / where | Allowed action |
| --- | --- | --- |
| Isolated / LOTO | Qualified maintenance, energy isolated | Mechanical work, guard removal, jam clearance, fluid service |
| Service / teach | Trained technician, restricted guarded area | Low-speed single-axis checks with enabling device as required by safety design |
| Manual slow | Trained operator, line of sight, commissioned area | Positioning/recovery at restricted speed; safety functions remain active |
| Auto travel | Approved route, operating-zone rules met | Navigate only; tools stowed and de-energized unless an approved special process says otherwise |
| Auto task | Approved task zone, recipe and cassette | Bounded module action with supervisor policy required for pilot |
| Washdown / decontamination | Defined wash area | Correct cassette removal/covering, electrical isolation and chemical procedure |

### Required checklists

**Pre-shift:** inspect tyres, wheel/arm/tool guards, latches, cables/glands, scanner windows, lenses, e-stops, bumper, fluid leaks, battery/service state; run safety self-test; confirm map/route/cassette/chemical/feed/egg tray and operator authorization.

**After task:** park/de-energize, reconcile product/chemical/egg inventory and exceptions, clean according to cassette SOP, inspect contamination/sensor surfaces, upload events, report any strike/stop/near miss before reuse.

**After contact, tip risk, chemical spill or unexpected behavior:** e-stop/isolate as appropriate, exclude people/animals, preserve logs, follow farm emergency process, inspect by authorized personnel, and repeat relevant verification before return.

## 6. Required safety evidence before supervised pilot

- signed hazard analysis, risk reduction rationale, safety-requirements specification and traceability matrix;
- safety architecture schematic, component certificates/data, wiring inspection and functional safety validation plan/results;
- measured stop-time/distance and protective-field tests across payload, speed, surface, gradient and fault cases;
- brake/holding, stability/turn/tilt, module retention, arm/tool force and stored-energy tests;
- weather/washdown/dust/EMC/environment evidence appropriate to the claimed ODD;
- food/feed materials/process review, chemical SDS/compatibility/waste plan, animal-welfare/biosecurity review;
- operating, inspection, cleaning, service, rescue, LOTO, training and incident-response documents;
- configuration/cybersecurity/update and data-retention records; and
- independent review sign-off in the target market.
