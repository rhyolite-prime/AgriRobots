# 04 — Preliminary BOM and make/buy plan

**Document:** AGR-SCM-040 · **Revision:** A · **Status:** planning estimate only
**Currency:** 2026 USD, budgetary bands. Not a quotation; excludes engineering labor, certification, duties, tax, shipping, pilot-site construction, and consumables.

## 1. Costing assumptions

- Quantities are **one engineering prototype**, not production volume.
- Safety sensors, batteries, traction drives, industrial compute and custom machining vary substantially by region/supplier.
- Select suppliers only after environmental, support, lifecycle, safety and service evaluations. Listing a component class is not a certification claim.
- Target to reuse the AP-01 carrier across all module trials; do not buy four separate autonomous bases.

## 2. AP-01 carrier prototype BOM

| Subsystem | Buy/make | Budget band (USD) | Notes / design decision |
| --- | --- | ---:| --- |
| Welded frame, trays, covers, bumpers, fasteners | Make/fabricate | 4,000–9,000 | Include corrosion test coupons and service access; freeze material after FEA/corrosion review |
| Four wheel/traction modules + gearing/brakes | Buy + integrate | 5,000–12,000 | Require torque/thermal curves, encoder and brake fail-safe behavior; avoid opaque hobby motors |
| Steering actuators/linkages | Buy + make | 2,000–5,000 | 4WS limits and mechanical end stops needed |
| 48 V 100 Ah LiFePO₄ battery, BMS, enclosure | Buy | 2,500–6,000 | Document transport, isolation, thermal, service and battery supplier support |
| Contactors, fuses, pre-charge, DC/DC, harness | Buy + make | 2,000–5,000 | HV/LV separation, service disconnect, insulation/grounding plan |
| Safety PLC/I/O, E-stops, bumpers, safety lidar(s), beacons | Buy | 8,000–18,000 | Exact category/coverage derives from risk assessment; this is not the place to reduce cost first |
| Compute, SSD, managed network, GNSS/IMU | Buy | 3,500–9,000 | Industrial temperature/lifecycle preferred; RTK optional depending on field ODD |
| Navigation/task cameras and lighting | Buy | 1,500–5,000 | Protect, heat manage and clean lenses; select after imaging survey |
| UCI rails/latches/connector/sensors | Make + buy | 1,500–4,000 | Test with representative dummy mass and contamination |
| Charge dock / manual charge safety equipment | Make + buy | 2,000–7,000 | Start with supervised manual charge if automated dock adds schedule risk |
| **AP-01 hardware total** |  | **32,000–80,000** | Prototype band; excludes labor/validation |

## 3. Cassette prototype BOMs

| Cassette | Major contents | Budget band (USD) | Buy/make decision notes |
| --- | --- | ---:| --- |
| EG-01 egg collection | Frame, compliant arm/Cartesian boom, vacuum/gripper, camera/light, tray carousel, washable interfaces | 8,000–25,000 | De-risk end effector/nest fixture first; food-contact material and sanitation process gate purchase of treatment equipment |
| FD-01 dry feed | Food/feed-compatible hopper, agitator/auger/valve, load cell, chute, controls, cleanout | 3,000–10,000 | Bench meter before vehicle integration; retain calibration fixtures |
| CS-01 clean/sanitize | Tank/baffles, compatible pump/manifold/nozzles, optional recovery, leak/flow/pressure sensing, containment | 4,000–15,000 | Chemistry selection drives seals/pump/PPE/waste path; do not procure blind |
| WD-01 early weed | Global-shutter camera/light, calibration target, X-Y-Z tool stage, guards, tool head/precision dispenser, MCU | 8,000–30,000 | Dataset/actuation method determines final design; start camera rig + mechanical test stage separately |
| **All four cassette prototypes** |  | **23,000–80,000** | Sequential build can avoid buying unresolved items |

### Planning total

**Hardware-only first platform (AP-01 + all four prototype cassettes): USD 55,000–160,000.** Add a meaningful contingency (typically 25–35% at this concept maturity), field infrastructure, consumables, testing, independent safety/compliance work, and labor. The high uncertainty is intentional: site geometry, safety requirements, egg process, and weed actuator are not frozen.

## 4. Procurement critical path

| When | Item / action | Why it cannot wait |
| --- | --- | --- |
| Weeks 0–4 | Safety engineer/process owners, site survey equipment, representative eggs/feed/soil data agreement | Determines scope and safety/food/chemical constraints |
| Weeks 3–6 | Candidate battery/BMS, safety lidar/I/O, wheel modules, compute platform samples | Long lead; needs bench integration before CAD is frozen |
| Weeks 5–10 | Frame material, UCI components, high-cycle connectors, latches, representative load dummy | Required to test mechanical/electrical interchange before module designs diverge |
| Weeks 8–16 | Motor/steering/brake package and safety HIL equipment | Carrier mule and stopping tests are gate-critical |
| Weeks 10–18 | Feed auger, pump/seals/nozzles, arm/stage samples, camera/lighting | Bench de-risk task physics before full cassette fabrication |
| Weeks 12–24 | Production-like sensors/compute, spares, enclosure/panel fabricator | Need enough time for environmental/integration rework |

## 5. Make/buy boundaries

| Make / own | Buy / qualify | Reason |
| --- | --- | --- |
| Frame, cassette shell, UCI adapters, brackets, fluid routing, tool fixtures, wiring harness drawings, ROS integration, task API, recipe schemas, calibration/data tooling | Battery cells/BMS, safety controller/I/O, safety scanner, motor drive, industrial compute, camera, connector, bearing, pump, reducer | Own the interface and task IP; purchase safety-/lifecycle-critical components with test data and support |
| Cassette firmware state machines and diagnostics | Certified power/safety building blocks | Keep behavior observable and configurable while avoiding unverified protection hardware |
| CAD/URDF, digital twin, validation fixtures, tests and evidence | Independent test/calibration/compliance services | Preserve repeatability and secure independent review where needed |

## 6. Required supplier evidence

For each safety-, energy-, food/feed-, chemical-, or motion-critical bought item, retain:

1. revision-controlled data sheet, environmental limits, derating curves, MTBF/lifecycle status and country of origin;
2. material declaration and, where relevant, food-contact/chemical compatibility statement;
3. wiring/pinout, protective circuit, failure behavior, firmware version/update method and change notification policy;
4. performance test data at the proposed voltage/current/pressure/load—not just a nominal catalogue value;
5. service/spare lead time, RMA process and end-of-life notice commitment; and
6. incoming-inspection plan, serial tracking and approved-substitute process.

## 7. Prototype workshop and test equipment

Budget and reserve physical space for more than the robot: lockout/tagout, insulated power bench, HV measurement gear, torque tools, load cells/scales, pressure/flow meters, calibration targets, network/firmware fixtures, a representative dummy cassette, mobile restraint/guarding, test egg/nest fixture, feed metering bench, fluid containment, washdown area, and a guarded field test lane. These are program-critical assets rather than optional lab accessories.
