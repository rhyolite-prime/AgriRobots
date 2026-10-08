# simulation/hil

Power and safety hardware-in-the-loop bench adapters.

**Status:** placeholder. The bench itself is specified in
[`docs/07_HARDWARE_BUILD_GUIDE.md`](../../docs/07_HARDWARE_BUILD_GUIDE.md).

## Purpose

Prove the safety chain with real electrical behaviour before autonomy runs on a
vehicle: e-stop, protective fields, latch/ID interlock, brake, tool permit,
heartbeat loss, insulation and overspeed inputs.

## Rules

- HIL is the bridge between simulation and vehicle tests. A scenario must pass in
  simulation, then on HIL, then on the machine, with the same expected safe state.
- The safety controller under test must be the real device with its real firmware
  and configuration hash — not a software stub.
- HIL may never be used to bypass or simulate away a physical stop path.
- Every HIL run records configuration IDs, injected fault, measured reaction time
  and resulting physical state as `VVT-SAF-*` / `VVT-EE-*` evidence.
