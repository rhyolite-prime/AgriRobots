# ros_ws/src

Colcon source space. Each entry will be a ROS 2 Jazzy package with its own
`package.xml`, lifecycle nodes, typed interfaces and tests.

**Status:** empty. No package may be added here until:

1. its responsibility and safety criticality are recorded in
   [`../planned-packages.yaml`](../planned-packages.yaml);
2. the interfaces it publishes and consumes exist in `@agrirobots/contracts`; and
3. its verification evidence class (`VVT-NAV-*`, `VVT-SAF-*`, `VVT-EXE-*`, …) is
   named.

Planned packages: `agri_bringup`, `agri_safety_bridge`, `agri_base`,
`agri_localization`, `agri_nav`, `agri_perception`, `agri_module_manager`,
`agri_executor`, `agri_recorder`, and one behaviour controller per cassette
(`agri_fd`, `agri_eg`, `agri_cs`, `agri_wd`).

Rules that apply to every package here:

- No package may widen a safety limit, cancel an e-stop or re-arm after a safety
  stop without the documented inspection/reset sequence.
- Every node reports health and quality; `UNKNOWN` or `STALE` is inhibiting.
- Recorded runs must be reproducible: message definitions, parameters, map
  revision, calibration and software versions are part of the record.
