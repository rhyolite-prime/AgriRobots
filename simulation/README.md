# simulation — digital twin, replay and HIL

Simulation exists to reduce risk before physical tests, not to replace them.

**Status:** placeholders. No worlds, scenarios or benches exist yet.

| Directory | Purpose |
| --- | --- |
| [`gazebo`](gazebo/README.md) | Worlds, URDF/Xacro descriptions, scenarios and fault injection |
| [`replay`](replay/README.md) | Recorded-run and dataset playback for regression |
| [`hil`](hil/README.md) | Power/safety hardware-in-the-loop bench adapters |

## Standing rules

- The twin must use the same frames, contracts and identifiers as the edge
  system: `map → odom → base_link → cassette_link → tool_link`.
- A scenario that passes in simulation is a **necessary** condition, never
  sufficient evidence for braking distance, stability, force, EMC, cleanability,
  food/process, chemical, animal-welfare or crop-protection acceptance.
- Injected faults must produce the same safe state in simulation, HIL and vehicle
  tests; a mismatch is a defect in one of the three, not an acceptable difference.
- Synthetic or photorealistic data may support perception work only with a
  documented comparison against held-out site data.

See [`docs/08_IMPLEMENTATION_PLAN.md`](../docs/08_IMPLEMENTATION_PLAN.md) §4 WS-D.
