# apps/virtual-lab

Nuxt 4 Virtual Lab (browser studio): compile an `agri.task/v1` script, execute it
against the ARACNID kinematic twin, and replay the journal, the safety functions
and the twin frames it produced.

**Status:** first cut — implemented, typechecked, built, tested and served. The
whole ARACNID round runs from the browser: pick a task, pick a scenario, inject a
fault, run, scrub. Evidence, all reproduced on this branch:

- `npm run typecheck --workspace apps/virtual-lab` (`nuxt typecheck`, `vue-tsc`)
  is clean across `app/`, `server/`, `shared/` and `nuxt.config.ts`.
- `npm run build --workspace apps/virtual-lab` produces a Node server bundle
  (3.2 MB, 804 kB gzipped) and `node .output/server/index.mjs` serves the app and
  the API.
- `apps/virtual-lab/test/` — 45 tests (35 on the isomorphic modules and server
  utilities, 10 on frame blending and the colour vocabulary), run by the
  repository root's `vitest` inside `npm run verify` (190 tests in total).
- Every scenario below was executed through the running dev server's
  `POST /api/missions/run`, not quoted from a design note.

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
| `nuxt.config.ts` | Nuxt 4, SSR on, dev server bound to `0.0.0.0` with an open host allow-list; workspace packages aliased to their TypeScript sources and inlined into Nitro |
| `server/api/tasks.get.ts` | The task shelf: every committed `.agri` example, compiled, with hashes and statistics |
| `server/api/tasks/[id].get.ts` | One task's source plus its compiled summary |
| `server/api/scenarios.get.ts` | The ARACNID scenario, fault and nest-layout catalogue, and the geometry the twin draws |
| `server/api/missions/run.post.ts` | Validates the request, compiles, runs the mission against `AracnidWorld`, returns journal + twin frames + checkpoint |
| `server/utils/lab-tasks.ts` | The closed list of loadable tasks — paths never come from the browser |
| `server/utils/compiled-summary.ts` | Reduces a `CompiledTask` to what the UI shows |
| `server/utils/errors.ts` | Compiler and policy errors surfaced verbatim, with their codes |
| `app/shared/lab-types.ts` | The wire format, typed on both sides |
| `app/shared/journal-lines.ts` | Journal → timeline rows: mission-relative time, a one-line summary per event kind, the noise filter, and the mission-time ordering |
| `app/shared/safety-view.ts` | Derives permits, claims, tripped functions, breaches, inhibitions and the safe stop from a journal prefix |
| `app/shared/safety-functions.ts` | The SF-AR-01…10 table transcribed from `docs/10` §6, plus exit-code meanings |
| `app/shared/scenarios.ts` | One scenario/fault/layout catalogue for the picker and the validator |
| `app/shared/ir-render.ts` | Renders compiled `agri.expr/v1` nodes back to readable conditions |
| `app/lib/twin-scene.ts` | Three.js scene: rover, eight arms on the 620 mm ring, nest bank, magazine trays, worker marker; REP-103 → Three.js axis conversion and frame blending |
| `app/composables/useLab.ts` | Lab state: shelf, task source, request, result, determinism comparison |
| `app/composables/usePlayback.ts` | Mission-clock playback with pause, scrub, speed and loop |
| `app/composables/useRunTimeline.ts` | One derivation of "where the mission is now", shared by every panel |
| `app/components/LabHeader.vue` | Task, IR hash, journal hash, outcome, determinism |
| `app/components/MissionControlPanel.vue` | Task, scenario, seed, nest geometry, egg count, fault injection, run |
| `app/components/TwinViewport.vue` | The 3D twin, its overlay and its legend |
| `app/components/PlaybackBar.vue` | Playhead, transport, speed, and the statement the playhead is inside |
| `app/components/RunSummary.vue` | Outcome, exit code and its meaning, tally, visits, wall time |
| `app/components/SafetyPanel.vue` | Safety state, SF-AR-01…10 with tripped/why, permits, claims, denials, breaches, degraded mode |
| `app/components/JournalPanel.vue` | The causal journal with the noise filter, kind filter and per-row payload |
| `app/components/CompiledTaskPanel.vue` | The compiled task: hashes, statistics, limits, preflight as written, statement index |
| `app/app.vue` | The console layout: three columns, no router, one view |
| `app/assets/css/main.css` | The console look: panels, pills, journal rows, tally strip |
| `test/lab-shared.test.ts` | The isomorphic modules and the server utilities, tested from the repository root against real runs |
| `test/twin-scene.test.ts` | Frame blending and the state/grade colour vocabulary, tested against frames from a real round |

## The API

| Endpoint | Returns |
| --- | --- |
| `GET /api/tasks` | The closed shelf: id, title, robot, summary, which worlds can execute it, IR and source hashes, statistics |
| `GET /api/tasks/:id` | One task's `.agri` source verbatim plus its compiled summary |
| `GET /api/scenarios` | Scenarios, fault kinds (and which need a hand), nest layouts, and the ARACNID geometry the twin draws |
| `POST /api/missions/run` | `{ wallMs, run, compiled, source, journal[], frames[], world{ describe, geometry }, checkpoint, epochMs }` |

`POST /api/missions/run` accepts `{ taskId, world, scenario?, seed?, nestLayout?,
eggsInBank?, faults?, maxVisits?, preflight? }` and refuses, with a code, anything
it cannot honour: `E_LAB_TASK_UNKNOWN` (404), `E_LAB_NO_WORLD`,
`E_LAB_WORLD_UNSUPPORTED`, `E_LAB_WORLD_MISMATCH` (422),
`E_LAB_SCENARIO_UNKNOWN`, `E_LAB_LAYOUT_UNKNOWN`, `E_LAB_FAULTS`,
`E_LAB_FAULT_KIND`, `E_LAB_FAULT_HAND` (400). Compiler and policy failures come
back as 422 with the validator's own issue list. Nothing is executed that was not
validated first, and nothing is validated against a path the browser supplied.

The run id is derived from the inputs — `lab-<taskId>-<scenario>-<seed>-<layout>`
— so the journal hash is a function of the request alone and running twice proves
determinism instead of hiding it. Nominal, seed 7, arc:
`journalHash ca0008e7fbb31f68…`, 297 journal rows, 40 twin frames, 41 statement
visits, 21 752 ms of mission time in ~7 ms of wall time.

## What a run shows

Measured through this app's API, `aracnid-egg-collection`, seed 7, arc nest:

| Scenario | Status | Exit | Code | Picked/placed | Cracked | Abstained | Mission ms | Rows | Frames |
| --- | --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: |
| `nominal` | completed | 0 | — | 8/8 | 0 | 0 | 21 752 | 297 | 40 |
| `nominal`, straight nest | completed | 0 | — | 6/6 | 0 | 2 | 18 288 | — | — |
| `low-confidence` | aborted | 1 | `E_TASK_ABORTED` | 0/0 | 0 | 0 | 5 633 | 34 | 4 |
| `seal-loss` | completed | 0 | — | 7/7 | 0 | 0 | 20 252 | 279 | 36 |
| `cracked-egg` | completed | 0 | — | 7/7 | 1 | 0 | 20 252 | 279 | 36 |
| `worker-presence` | inhibited | 4 | `EGGS_ROUND_ABORTED` | 8/0 | 0 | 0 | 10 552 | 185 | 25 |
| `tilt-breach` | inhibited | 4 | `EGGS_ROUND_ABORTED` | 8/0 | 0 | 0 | 10 552 | 175 | 24 |
| `magazine-full` | failed | 1 | `EGGS_ROUND_ABORTED` | 8/0 | 0 | 0 | 13 752 | 195 | 25 |
| `fewer-eggs-than-hands` | failed | 1 | `EGGS_ROUND_ABORTED` | 3/0 | 0 | 5 | 10 551 | 172 | 23 |

Two things in that table are worth reading carefully, because they are the point
of the lab:

- **Exit 4 is not the reason.** `EGGS_ROUND_ABORTED` is the code the task's own
  `on_fault` clause reports. What actually stopped the machine — `E_GUARD_BREACH`
  for tilt, `E_PERMIT_DENIED` with SF-AR-07 tripped for a worker in the cell — is
  in the journal, and the safety panel derives it from there rather than from the
  exit code. An inhibition the UI could not explain would not be reviewable.
- **Abstentions are not successes.** In the straight nest two hands cannot reach
  and abstain; the quorum of 6 still holds, so the round completes with six eggs.
  In `fewer-eggs-than-hands` five hands abstain and the quorum fails, so the round
  faults. Same mechanism, opposite outcome, and the difference is visible in the
  tally rather than buried in a log.

## Running it

```bash
npm install                                    # from the repository root
npm run dev --workspace apps/virtual-lab       # http://localhost:3000
npm run build --workspace apps/virtual-lab     # production bundle in .output/
npm run preview --workspace apps/virtual-lab   # serve that bundle
npm run typecheck --workspace apps/virtual-lab # vue-tsc over app, server and shared
npm run verify                                 # from the root: includes the lab's tests
```

The dev server binds `0.0.0.0:3000` and accepts any host header, so it works
behind a proxied preview; if port 3000 is taken Nuxt picks the next one and
prints it. The browser only ever calls relative `/api/...` paths — nothing in
`app/` reaches for `localhost`.

## Design decisions, and where they depart from the plan

1. **Execution is server-side, not WASM.** `docs/09` §11 E9 assumed a browser
   build of the compiler core. The lab runs the real packages in Node behind an
   API instead: one implementation to keep honest, no executor in the client, and
   the IR hash on screen is the one CI pins. WASM stays open for offline
   authoring.
2. **Plain `three`, not `@tresjs/core`.** The twin is driven by journal frames —
   40 poses for a nominal round — so the scene is built once and updated
   imperatively in `app/lib/twin-scene.ts`. A declarative scene graph would
   re-diff eight arm chains per frame to express what is a direct pose write.
   `BOOTSTRAP.md` prescribed TresJS; this is the recorded deviation.
3. **`app/shared/`, not a root `shared/`.** Nuxt 4's convention is a root
   `shared/` for isomorphic code, but Nuxt 4.6 externalises those modules in the
   SSR build and emits a path relativised against the wrong base, so Nitro cannot
   resolve them and the production build fails. Inside `app/` they are bundled
   normally. Both server and client import them by relative path; the modules
   themselves stay pure (no Nuxt, no `three`, no Node APIs), which is what makes
   them testable from the repository root.
4. **Causal journal, time-ordered timeline.** The engine appends journal rows in
   the order it decided things, and at a parallel join that is not mission-time
   order. The journal panel shows causal order (the audit record); the playhead,
   the safety view and the trace strip use `inTimeOrder()`. `runMission` returns
   twin frames sorted by `t`, because a playback timeline has one meaning.
5. **One view, no router.** The lab is a console, not a site: `app/app.vue` lays
   out three columns and there is no `pages/` directory. Nothing here needs a
   route, and a route would only add a way to lose the run in view.
6. **The round is executed docked, and frames are snapshots.** The ARACNID task
   has no `move` statement — the rover is already at the nest bank when the round
   starts (`docs/10` §9.1 records that assumption), so what the twin animates is
   the arms, the magazine and the battery, not the chassis. Twin frames are
   published per statement, not per millisecond: 40 snapshots for a nominal round.
   `blendFrames()` is what turns those snapshots into motion, interpolating
   continuous values and taking discrete state (parked, arm state, grade, safety)
   from the later frame so nothing is ever half-applied.
7. **A procedural twin, not an imported asset.** The rover, arms, nest bank and
   trays are drawn from the geometry the engine reports (`world.geometry`), so
   the picture cannot disagree with the numbers. `packages/asset-import` and the
   GLTF/URDF path in `BOOTSTRAP.md` §2 stay unimplemented: there are no committed
   CAD assets to load yet.

## What is missing

- No app-level component tests. The 35 tests cover the pure modules and the
  server utilities; the Vue components are exercised by hand and by `vue-tsc`.
- No persisted runs. A run lives in the page; reloading loses it. The checkpoint
  is returned and displayed, but the lab has no store to resume from.
- No `agric` CLI, no signing, no artifact hashes beyond the IR and source hashes
  the compiler already produces.
- No asset ingestion (GLTF/URDF), no module-manifest panel, no recipe-review
  panel and no capability-gate panel — the other four items `BOOTSTRAP.md` §2
  asked for. The ARACNID slice came first because it is the first robot.
- No suspension UI. The engine can suspend and resume a mission (`await`, exit 3)
  and the lab shows the checkpoint, but it offers no way to answer a suspended
  mission and resume it.
- The 3D twin is kinematic: poses, states and colours. No dynamics, no contact,
  no litter, no birds.

## Hard boundaries

- The browser is **not** a safety controller and must never be the only path to
  a physical enable. It displays; `packages/engine`'s `IndependentSafetyModel`
  decides, on the server.
- No ROS internals and no robot hardware in this app. It reads typed contracts
  and a journal.
- No safety-mode override, no OTA trigger, no fleet credentials and no signing
  keys from the browser.
- Rendering degrades to WebGL; WebGPU is an optimisation, not a requirement.
- Task sources are read from a closed list in `server/utils/lab-tasks.ts`. No
  request-supplied path ever reaches the filesystem.

Deferred beyond R0: circuit/pin designer, collaborative sessions, WebRTC,
photorealistic rendering, external CAD ingestion, fleet dashboards.

See [`docs/08_IMPLEMENTATION_PLAN.md`](../../docs/08_IMPLEMENTATION_PLAN.md) §4
WS-B, [`docs/09_DSL_AND_EXECUTION_ENGINE.md`](../../docs/09_DSL_AND_EXECUTION_ENGINE.md)
for the engine this lab drives,
[`docs/10_ARACNID_AR01_DESIGN_BASIS.md`](../../docs/10_ARACNID_AR01_DESIGN_BASIS.md)
for the machine it draws — including §9.1, which lists every placeholder number
the twin uses and the measurement that closes it — and
[`BOOTSTRAP.md`](BOOTSTRAP.md) for what was prescribed versus what was built.
