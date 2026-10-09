# apps/virtual-lab

Nuxt 4 Virtual Lab (browser studio): compile an `agri.task/v1` script, execute it
against the ARACNID kinematic twin, and replay the journal, the safety functions
and the twin frames it produced.

**Status:** in progress — the server side is complete and the first panels are
written; the app has not been installed or built yet, so nothing here is
verified by CI beyond lint. See [What exists](#what-exists) and
[What is missing](#what-is-missing).

## What the lab is for

The first ARACNID use case (`dsl/examples/aracnid-egg-collection.agri` on the
AR-01 rover with the EG-08 eight-hand cassette) needs a place where an engineer
can change a scenario, re-run the round and read exactly what the machine did
and why. That place is this app. It is a *reading* instrument:

- Compilation and execution happen on the server, in Node, in the same
  `@agrirobots/compiler-core`, `@agrirobots/policy` and `@agrirobots/engine`
  that CI tests. There is no second implementation in the browser.
- The browser receives a journal, twin frames and a summary. It renders them.
  It never dispatches a capability and never decides a safety question.
- Runs are deterministic: a stable run id and a fixed seed mean the same inputs
  produce the same journal hash, and the header says so when you run twice.

## What exists

| Path | Purpose |
| --- | --- |
| `nuxt.config.ts` | Nuxt 4, SSR on, dev server bound to `0.0.0.0` with open `allowedHosts`; workspace packages aliased to their TypeScript sources and inlined into Nitro |
| `server/api/tasks.get.ts` | The task shelf: every committed `.agri` example, compiled, with hashes and statistics |
| `server/api/tasks/[id].get.ts` | One task's source plus its compiled summary |
| `server/api/scenarios.get.ts` | The ARACNID scenario and fault catalogue, and the geometry the twin draws |
| `server/api/missions/run.post.ts` | Validates the request, compiles, runs the mission against `AracnidWorld`, returns journal + twin frames |
| `server/utils/lab-tasks.ts` | The closed list of loadable tasks — paths never come from the browser |
| `server/utils/compiled-summary.ts` | Reduces a `CompiledTask` to what the UI shows |
| `server/utils/errors.ts` | Compiler and policy errors surfaced verbatim, with their codes |
| `shared/lab-types.ts` | The wire format, typed on both sides |
| `shared/journal-lines.ts` | Journal → timeline rows: mission-relative time and a one-line summary per event kind |
| `shared/safety-view.ts` | Derives permits, claims, tripped functions and breaches from a journal prefix |
| `shared/safety-functions.ts` | The SF-AR-01…10 table transcribed from `docs/10` §6, plus exit-code meanings |
| `shared/scenarios.ts` | One scenario/fault/layout catalogue for the picker and the validator |
| `shared/ir-render.ts` | Renders compiled `agri.expr/v1` nodes back to readable conditions |
| `app/lib/twin-scene.ts` | Three.js scene: rover, eight arms on the 620 mm ring, nest bank, magazine trays, worker marker |
| `app/composables/useLab.ts` | Lab state: shelf, request, result, determinism comparison |
| `app/composables/usePlayback.ts` | Mission-clock playback with pause, scrub, speed and loop |
| `app/components/LabHeader.vue` | Task, IR hash, journal hash, outcome, determinism |
| `app/components/MissionControlPanel.vue` | Task, scenario, seed, nest geometry, fault injection, run |
| `app/components/TwinViewport.vue` | The 3D twin, its overlay and its legend |
| `app/assets/css/main.css` | The console look: panels, pills, journal rows, tally strip |

## What is missing

- `app/app.vue` and the remaining panels (playback bar, run summary, safety
  panel, journal panel, compiled-task panel) — the layout is designed, the
  components are not all written.
- `npm install` has not been run here, so the app has never been built or served.
- No app-level tests yet. The pure logic in `shared/` is written to be testable
  from the repository root without Nuxt.

## Running it

```bash
npm install                        # from the repository root, once the app is a workspace
npm run dev --workspace apps/virtual-lab
```

Then open the printed URL. The dev server binds `0.0.0.0:3000` and accepts any
host header, so it works behind a proxied preview; the browser only ever calls
relative `/api/...` paths.

## Hard boundaries

- The browser is **not** a safety controller and must never be the only path to
  a physical enable. It displays; `packages/engine`'s `IndependentSafetyModel`
  decides, on the server.
- No ROS internals and no robot hardware in this app. It reads typed contracts
  and a journal.
- Rendering degrades to WebGL; WebGPU is an optimisation, not a requirement.
- Task sources are read from a closed list in `server/utils/lab-tasks.ts`. No
  request-supplied path ever reaches the filesystem.

Deferred beyond R0: circuit/pin designer, collaborative sessions, WebRTC,
photorealistic rendering, external CAD ingestion, fleet dashboards.

See [`docs/08_IMPLEMENTATION_PLAN.md`](../../docs/08_IMPLEMENTATION_PLAN.md) §4
WS-B, [`docs/09_DSL_AND_EXECUTION_ENGINE.md`](../../docs/09_DSL_AND_EXECUTION_ENGINE.md)
for the engine this lab drives, and
[`docs/10_ARACNID_AR01_DESIGN_BASIS.md`](../../docs/10_ARACNID_AR01_DESIGN_BASIS.md)
for the machine it draws.
