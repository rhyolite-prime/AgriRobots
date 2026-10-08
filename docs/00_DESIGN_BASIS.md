# 00 — Design basis and requirements

**Document:** AGR-DES-000 · **Revision:** A · **Status:** Concept / not for fabrication
**Applies to:** AP-01 modular carrier and EG-01, FD-01, CS-01, WD-01 cassettes
**Units:** SI; drawing dimensions in mm unless explicitly marked otherwise.

## 1. Design intent

AgriRobots is a *platform program*, not four unrelated robots:

1. a protected electric mobile carrier supplies energy, movement, localization, data, safety supervision and an interchangeable payload bay;
2. an authenticated cassette supplies only its task-specific hardware and declares its limits; and
3. a policy-controlled execution engine turns approved recipes into bounded actions.

The first product is a **supervised autonomous** machine. “Autonomous” means it may traverse a commissioned route and carry out an approved task within a defined zone; it does not mean it can safely operate anywhere or decide a new chemical/animal-handling process.

## 2. Intended use and explicit limits

| Use case | AP-01 release-A intent | Not in release-A scope |
| --- | --- | --- |
| Egg picking / sanitization | Collect loose/nest eggs into a traceable tray under supervision. Sanitize *equipment/nest surfaces only after a process validation*. | Generic egg washing, shell treatment, grading, or food-process validation by software alone |
| Periodic feed | Meter pre-approved dry feed to poultry and small livestock (sheep/goats/pigs) along commissioned routes. | Cattle-scale bulk distribution, silage/hay handling, free roaming outdoors without a geofenced route |
| Cleaning / sanitation | Dry scrape/vacuum and low-pressure application to defined empty or controlled zones; document volume and dwell time. | High-pressure washdown around live animals/people, unapproved disinfectants, sewer discharge without approval |
| Selective early weeding | Locate crops/weeds, then mechanically disturb or dispense an approved micro-dose only in a guarded/supervised field pilot. | Autonomous herbicide use in public/open areas, actuation near an uncertain crop, guarantees across unknown cultivars/conditions |

### Operating design domain (ODD) — starting assumption

- Indoor: level, drained concrete or compacted floor; maximum confirmed grade 5%; minimum clear aisle 1,000; temperature 5–35 °C; no explosive dust atmosphere unless re-engineered.
- Field: daylight or controlled illumination; surveyed headland/tramline; maximum confirmed grade 8%; no standing water; soil and vegetation that do not exceed tyre tractive limits; remote supervisor present during pilot.
- Shared areas: route commissioning, speed, detection fields, visibility, and animal behavior must be validated per site. Animal welfare is a design input, not merely an obstacle-detection problem.
- The robot stops to a safe state for a safety-channel fault, localization loss outside degraded policy, module identity mismatch, battery/contactor fault, protective field intrusion, loss of heartbeat, tilt limit, or e-stop.

## 3. Design assumptions that must be frozen

These values intentionally remain adjustable; they are not hidden promises.

| ID | Assumption to validate | Revision-A provisional value | Consequence if it changes |
| --- | --- | ---:| --- |
| A-01 | Minimum passable indoor aisle | 1,000 | May require a narrower chassis or one-way route plan |
| A-02 | Largest filled cassette mass | 125 kg | Alters braking, stability, tyre, rail and lift/dock design |
| A-03 | Continuous duty / recharge window | 4 h / 2 h | Sizes battery fleet and charge dock |
| A-04 | Field crop system | vehicle travels on a surveyed lane beside/over a compatible bed | Determines wheel track, tool reach, camera location and RTK need |
| A-05 | Feed product | dry, free-flowing pellet/crumb | Wet feed needs a different hygienic auger/pump cassette |
| A-06 | Cleaning chemistry and discharge | pending local approval | Determines seals, tank, recovery, PPE and record system |
| A-07 | Egg collection geometry | nest access and tray standard pending farm survey | Determines end effector, arm reach and cassette layout |
| A-08 | People/animals co-presence | expected | Drives safety field coverage, speeds and operational procedure |

## 4. System decomposition

```text
                  Farm/Wi-Fi/VPN (non-safety; authenticated)
                              │
              ┌───────────────▼────────────────┐
              │ Mission manager + recipe signer │
              └───────────────┬────────────────┘
                              │ ROS 2/DDS
 ┌──────────────┐      ┌───────▼──────────────────────────────┐      ┌───────────────┐
 │ Operator HMI │◀────▶│ AP-01 autonomy computer               │◀────▶│ Cassette nodes │
 └──────────────┘      │ Nav / perception / executor / logger │      └───────────────┘
                        └───────┬──────────────────────────────┘
                                │ bounded commands + heartbeat
                        ┌───────▼──────────────────────────────┐
                        │ Independent safety controller         │
                        │ E-stop, lidar, bumper, tilt, contactor│
                        └───────┬──────────────────────────────┘
                                │ safe torque/energy enable
         ┌──────────────────────▼─────────────────────────────────────┐
         │ Drive, steering, power contactors, tool safe-enable valves │
         └────────────────────────────────────────────────────────────┘
```

The perception computer may propose a move or tool pulse. It never provides the sole protective function for a person, animal, or crop.

## 5. Top-level measurable requirements

“Verify” means the named evidence must exist in the verification matrix before pilot release.

| ID | Requirement | Target / limit | Verify |
| --- | --- | --- | --- |
| SYS-001 | Carrier envelope | ≤1,450 L × 780 W × 1,050 H including bumpers/sensors in transport state | Measure against AGR-100 |
| SYS-002 | Interchangeability | Any approved cassette seats on four datum features and locks without modifying carrier structure | Gauge, fit test, 100-cycle exchange test |
| SYS-003 | Payload | Support 125 kg rated cassette payload; no operation above cassette-specific CG envelope | Analysis + static/dynamic test |
| SYS-004 | Energy isolation | E-stop, safety stop or isolation fault removes traction and hazardous-tool energy through an independent path | Fault-injection test |
| SYS-005 | Safe module identity | Motion/tool enable is inhibited unless ID, capability manifest, latch inputs and connector lock agree | Unit + HIL tests |
| SYS-006 | Operational event record | Log recipe hash, map/zone, module serial, software versions, operator, command/result and safety events | Audit test |
| SYS-007 | Navigation degradation | Outside an approved degraded mode, loss of localization or localization integrity transitions to controlled stop | Simulation + vehicle test |
| SYS-008 | Cleanability | Product/chemical-contact parts are removable or clean-in-place according to validated SOP; no uninspectable product traps in feed/egg path | Design review + cleaning validation |
| SYS-009 | Crop protection | WD-01 may actuate only with plant, pose, time-synchronization and confidence gates satisfied; otherwise record/skip | Replay + guarded plot test |
| SYS-010 | Change control | A new tool, recipe capability, safety field, chemistry, route or mass/CG requires review and re-verification | Configuration audit |

## 6. Performance targets, not accepted facts

The following are engineering **targets**. They are not claimed performance until field-tested for the named farm/crop/process.

| Capability | Pilot target | Critical measurement |
| --- | --- | --- |
| Carrier route repeatability indoors | ±30 mm 95th percentile along commissioned route | Survey reference / localization logs |
| Carrier route repeatability field, RTK available | ±25 mm cross-track 95th percentile after integrity monitor passes | RTK/total-station reference |
| Egg pick | ≥95% successful picks of accessible test eggs; <1% new crack rate attributable to handling | Randomized nest/tray test with before/after inspection |
| Feed dosing | ±5% at each approved feed type and 0.5–10 kg setpoint | Calibrated scale; repeatability chart |
| Wet sanitation application | ±10% delivered volume, with documented dwell window | Flow meter + timed witness coupons |
| Crop/weed decision | Crop recall and weed precision thresholds set per crop before field enable; uncertain detections must abstain | Held-out labelled set + field audit |
| Mechanical weeding placement | ≤±5 mm tool placement at ≤0.30 m/s in guarded test lane | Surveyed targets/high-speed video |

## 7. Configuration and drawing conventions

- Coordinate system: **X** forward; **Y** left; **Z** upward. Carrier origin is ground projection of the cassette-bay geometric centre. Datum A is cassette support plane; B is longitudinal centre plane; C is forward datum face.
- All fabrication-critical items need a released 3D CAD model, material callout, weld symbols, tolerance stack, FEA, and inspection plan. The SVG sheets are controlled *concept* geometry only.
- Nominal dimensions lack tolerance only where they express an envelope. Initial fabrication assumptions are ISO 2768-mK equivalent only after a manufacturing engineer confirms them.
- Configuration IDs: `AP01-Rx` carrier; `EG01-Rx`, `FD01-Rx`, `CS01-Rx`, `WD01-Rx` cassettes; `recipe@semver+sha256` execution recipe.

## 8. Design decisions to make at kickoff

1. Is “egg sanitization” an egg-shell process, nest/equipment sanitation, or both—and in which jurisdiction?
2. Which one poultry house and one crop system are the first pilot site? Design the first release around them.
3. What are the minimum aisle, headland, bed width, row spacing, ground grade, and transition obstacles?
4. Does the field system allow the vehicle to travel alongside the bed, between rows, or straddle it?
5. What exact feed type, doses, trough geometry, animal behavior, and refill workflow are required?
6. Which chemicals, water source, drainage/recovery rules, and PPE procedures are approved?
7. Is a trained supervisor continuously present during every pilot? If not, safety architecture/scope must change.
