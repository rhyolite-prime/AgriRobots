# Drawing index — concept engineering sheets

**Drawing revision:** A · **Date:** 05 October 2026
**Status:** Every sheet is a vector **concept drawing / NOT FOR FABRICATION**. All dimensions are in millimetres unless marked. SVGs retain clean vector lines and may be reviewed in a browser or CAD/vector tool.
**ARACNID set (AGR-120/130/210):** added 09 October 2026 with the [AR-01/EG-08 design basis](../docs/10_ARACNID_AR01_DESIGN_BASIS.md); the AR-01 carrier and EG-08 cassette share the UCI-01 contract with the cassettes above.

| Drawing | File | Purpose |
| --- | --- | --- |
| AGR-100 | [AP-01 carrier general arrangement](AGR-100_AP01_CARRIER_GA.svg) | Carrier top/side envelope, wheels, deck, mast and coordinate convention |
| AGR-110 | [UCI-01 universal cassette interface](AGR-110_UCI01_PAYLOAD_INTERFACE.svg) | Cassette footprint, support/latch centres, locator concept and interface section |
| AGR-120 | [AR-01 ARACNID carrier general arrangement](AGR-120_AR01_CARRIER_GA.svg) | ARACNID rover: plan/side/front with deployed envelope, cassette-bay detail, stability and safety notes |
| AGR-130 | [AR-01 picking arm and compliant suction hand](AGR-130_AR01_ARM_AND_HAND.svg) | 3-DOF arm elevation, joint ranges and speeds, suction-hand section with force limit |
| AGR-210 | [EG-08 ARACNID egg collection cassette](AGR-210_EG08_ARACNID_EGG_MODULE.svg) | Eight-hand ring and magazine section, tray layout and per-egg traceability fields |
| AGR-200 | [EG-01 egg collection cassette](AGR-200_EG01_EGG_MODULE.svg) | Envelope, stowed arm/pick reach, trays and process hold points |
| AGR-300 | [FD-01 dry feed cassette](AGR-300_FD01_FEED_MODULE.svg) | Hopper/metre/chute arrangement and dimensional envelope |
| AGR-350 | [CS-01 cleaning/sanitation cassette](AGR-350_CS01_CLEAN_SANITATION_MODULE.svg) | Tank/pump/tool concept, segregation and envelope |
| AGR-400 | [WD-01 vision-guided early weeding cassette](AGR-400_WD01_WEEDING_MODULE.svg) | Camera and guarded tool envelope, X-Y-Z travel and actuation gates |

## Drawing-control rules

1. The controlling dimensions for a production build must be released in native 3D CAD and a reviewed fabrication package. Do not machine, weld, or procure from these SVGs.
2. A number without a tolerance on a concept sheet is an **envelope or nominal intent**, not an implied ISO tolerance.
3. Any change to carrier mass, payload mass/CG, UCI centres, wheel geometry, tool envelope, fluids, safety sensors or process chemical requires systems/safety review and revision.
4. `X` is forward, `Y` is left, and `Z` is up. The AP-01 origin is the ground projection of the cassette-bay geometric centre; cassette datum A is its support plane.
5. Dimensions and target performance in this package must be reconciled with the selected pilot site's ODD, local regulations and test evidence before CDR.

## Suggested path from these sheets to fabrication

1. Close the [site questionnaire](../docs/06_SITE_DISCOVERY_QUESTIONNAIRE.md) and update the requirements/ODD.
2. Produce parametric CAD (carrier, UCI, each cassette), a mass/inertia database, collision geometry and URDF from a single controlled source.
3. Complete tolerance stack-up, FEA, weld/fastener/joint analysis, motor/brake/thermal sizing, battery/harness protection, P&ID, material/finish selection and service ergonomics.
4. Issue drawings with GD&T, weld symbols, material/finish, inspection criteria, revision block, BOM, approved parts and manufacturing notes.
5. Validate the released build through the safety, stability, chemical/food-process and task test plans before changing its status from prototype.
