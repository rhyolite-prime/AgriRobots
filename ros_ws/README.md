# ros_ws — ROS 2 Jazzy edge workspace

Edge autonomy packages for AP-01 and its cassettes.

**Status:** placeholder. No ROS packages exist yet; `planned-packages.yaml`
records the intended decomposition so the boundary is reviewable before code is
written. Build output (`build/`, `install/`, `log/`) is ignored by Git.

## Non-negotiable boundary

ROS 2 is the **integration fabric**, not the safety controller:

- The independent safety controller owns `SAFE_STOP`, `READY`, `MANUAL_SLOW`,
  `AUTO_TRAVEL`, `AUTO_TASK` and `SERVICE`, and rejects illegal transitions.
- `agri_safety_bridge` is read-only status plus a bounded request interface. It
  never substitutes for the hardwired stop path, and stale status inhibits the
  mission.
- Motion commands are rate-limited and heartbeat-guarded; command timeout means
  zero request, then brake.
- Tasks request bounded actions (`NavigateToPose`, `Dock`, `DispenseMass`,
  `PlaceEgg`, `ApplyVolume`, `InspectPlant`, `ActuateTool`) — never raw motor PWM
  and never arbitrary topic publication from a recipe.
- Perception emits measurements with uncertainty, model ID and calibration ID. It
  does not command hazardous actuators.

## Planned layout

See [`src/README.md`](src/README.md) and [`planned-packages.yaml`](planned-packages.yaml).

Bring-up follows the ladder in
[`docs/07_HARDWARE_BUILD_GUIDE.md`](../docs/07_HARDWARE_BUILD_GUIDE.md): wheels
off the ground → tethered brakes only → tethered full mule → radio teleop →
supervised autonomy.
