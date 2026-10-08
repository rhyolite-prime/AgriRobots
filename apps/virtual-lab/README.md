# apps/virtual-lab

Nuxt 4 / Vue 3 browser studio: assemble AP-01 with a cassette on UCI-01, inspect
the module manifest and pin/capability mapping, review a compiled AgriScript
recipe, and export a versioned digital-twin specification.

**Status:** placeholder. No application code exists yet — the package joins the
npm workspace when it is bootstrapped (see `BOOTSTRAP.md`).

## Scope for the first release (R0)

| Feature | Contract it consumes |
| --- | --- |
| Module registry and assembly canvas | `@agrirobots/domain-model` |
| UCI fit, latch, connector and mass/CG validation | `@agrirobots/domain-model` manifest validator |
| Recipe review: source, errors, compiled graph, limits | `@agrirobots/compiler-core` |
| Capability and gate explanation | `@agrirobots/policy` |
| Event inspector (simulation/replay WebSocket) | `@agrirobots/contracts` `JournalEvent` |
| Digital-twin and URDF configuration export | `@agrirobots/contracts` twin spec |

## Hard boundaries

- The browser is **not** a safety controller and must never be the only path to
  a physical enable. It displays and exports; the safety controller decides.
- The UI may not embed ROS internals or talk to robot hardware directly. It reads
  typed contracts and a simulation/replay event stream.
- Compilation shown in the browser must be the same compiler core used by CI and
  the edge deployment tool (WASM build of `@agrirobots/compiler-core`), so a
  reviewed recipe is bit-for-bit the deployed recipe.
- Rendering must degrade to WebGL; WebGPU is an optimisation, not a requirement.

Deferred beyond R0: circuit/pin designer, multi-user collaborative sessions,
WebRTC, photorealistic rendering, external CAD ingestion, fleet dashboards.

See [`docs/08_IMPLEMENTATION_PLAN.md`](../../docs/08_IMPLEMENTATION_PLAN.md) §4
WS-B.
