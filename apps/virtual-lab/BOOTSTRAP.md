# Bootstrapping the Virtual Lab

This file was written before the app existed, as the instruction sheet for
creating it. It is kept as a **record**: what was prescribed, what was built, and
where the two differ and why. The deviations are decisions, not drift — each one
is stated with its reason so the next reader can overturn it deliberately.

**Outcome:** the app exists, installs, typechecks, builds, serves and is tested.
Evidence and the current contents are in [README.md](README.md).

## 1. Create the application

Prescribed:

```bash
npx nuxi@latest init apps/virtual-lab --packageManager npm --gitInit false
npm install --workspace apps/virtual-lab nuxt vue vue-router
npm install --workspace apps/virtual-lab @tresjs/core three
npm install --workspace apps/virtual-lab \
  @agrirobots/contracts @agrirobots/domain-model \
  @agrirobots/compiler-core @agrirobots/policy
```

Actual: the app was written file by file rather than scaffolded, and
`"apps/virtual-lab"` was added to the root `workspaces` array with the lockfile
regenerated in the same change (`npm ci` in CI fails on a desynced lockfile, so
the two must never be separated).

| Prescribed | Installed | Why |
| --- | --- | --- |
| `nuxi init` scaffold | hand-written tree | The scaffold is a pages-based starter with a landing page; the lab is one console view with no routes. Writing the tree directly kept the first commit reviewable |
| `nuxt` | `nuxt ^4.6.0` (4.6.0 resolved) | As prescribed. `future.compatibilityVersion` no longer exists in 4.6 — Nuxt 4 semantics are the default — so `nuxt.config.ts` sets only `compatibilityDate` |
| `vue` | `vue ^3.5.43` | As prescribed, via Nuxt |
| `vue-router` | not a direct dependency | There is no `pages/` directory and no navigation. Nuxt still provides the router; declaring it would invite routes the lab does not need |
| `@tresjs/core` + `three` | `three ^0.186.1` + `@types/three` only | **Deviation.** The twin is driven by 40 journal frames per round, so the scene is built once and written to imperatively in `app/lib/twin-scene.ts`. A declarative scene graph would re-diff eight arm chains per frame to express a direct pose write. See README §Design decisions 2 |
| `@agrirobots/{contracts,domain-model,compiler-core,policy}` | those four **plus `@agrirobots/engine`** | The engine did not exist when this file was written. It is the package the lab exists to show, and it is aliased to `packages/engine/src/index.ts` like the others and inlined into Nitro (their entry points are TypeScript sources, which Node cannot import directly) |

## 2. Minimum first increment

Prescribed five panels over committed repository data. Four of the five were
superseded by a narrower, deeper target: the ARACNID round end to end.

| # | Prescribed | Status |
| --- | --- | --- |
| 1 | List AP-01, UCI-01 and the four cassettes from `@agrirobots/domain-model` | **Not built.** The lab lists *tasks*, not modules. The module catalogue belongs to an assembly view, which needs `packages/asset-import` and a manifest panel to be worth showing |
| 2 | Three.js viewport loading one reference GLTF/URDF and showing `map → odom → base_link → cassette_link → tool_link` | **Built differently.** The viewport draws a procedural kinematic twin from the geometry and frames the engine reports, so the picture cannot disagree with the numbers. No CAD asset is committed yet, and the TF tree belongs to the ROS 2 bridge (`ros_ws`), not to a lab that has no robot |
| 3 | Manifest panel running `validateModuleManifest()` and printing every rejection reason | **Not built.** `packages/domain-model` implements it and CI tests it; no UI shows it yet |
| 4 | Recipe panel running `parseRecipeYaml()` + `validateRecipeDocument()` on `dsl/examples/poultry-evening-feed.yaml` | **Not built.** The shelf compiles the three `.agri` tasks; the YAML recipes are not on it. The compiled-task panel does show validator issues verbatim for `.agri` sources, which is the same discipline applied to the task language |
| 5 | Capability panel running `checkRecipeRequires()` and `checkReleaseReadiness()` with the gate/approval explanation | **Partly built.** The compiled-task panel lists the allow-list capabilities a task uses, with hazard class and minimum gate; the release-readiness explanation is not surfaced |

What was built instead, and why: the first robot is ARACNID, so the first thing
the lab had to answer was *"what does the eight-hand egg round actually do, and
what stops it?"* That is a compile → execute → replay loop over one task:

1. the task shelf (`GET /api/tasks`) with IR and source hashes for all three
   committed `.agri` examples;
2. a scenario picker over the eight ARACNID scenarios, two nest geometries, seed
   and egg count, plus six injectable fault kinds;
3. `POST /api/missions/run`, which compiles, executes against `AracnidWorld` and
   returns journal, twin frames, compiled summary, world description and
   checkpoint;
4. the 3D twin, playback, run summary, safety panel, journal panel and
   compiled-task panel, all derived from that one response.

Items 1, 3 and 4 above are the acceptance bar this file set — committed data, no
robot, no cloud service, no secrets — met on a different subject. Items 1, 3, 4
and 5 of the prescribed list remain open work; they are listed in README
§What is missing.

## 3. Configuration requirements

| Requirement | Met |
| --- | --- |
| `ssr: false`, or a Node server binding `0.0.0.0` and permitting the preview origin | Met with SSR on: `devServer.host = 0.0.0.0`, `vite.server.allowedHosts = true`, and a Nitro node-server bundle for production. SSR was chosen over `ssr: false` so the first paint is real HTML and the API is same-origin |
| No hard-coded `localhost` API calls from the browser | Met: `app/` only ever fetches relative `/api/...` paths. `three` is client-only behind `<ClientOnly>` |
| `.nuxt/`, `.output/` and generated asset caches ignored | Already ignored at the repository root |
| No file access outside the repository through user input; explicit validated path list | Met and tested: `server/utils/lab-tasks.ts` holds the closed shelf, a request names an id, and `test/lab-shared.test.ts` asserts that paths, case variants and unknown ids resolve to nothing |

One deviation, forced by the toolchain: the isomorphic modules live in
`app/shared/`, not in a root `shared/`. Nuxt 4's convention is a root `shared/`
directory, but Nuxt 4.6 externalises those modules in the SSR build and emits a
path relativised against the wrong base (`../../../../apps/virtual-lab/shared/…`
from `.nuxt/dist/server/server.mjs`), so Nitro cannot resolve them and
`nuxt build` fails. Inside `app/` they bundle normally. The modules stay pure —
no Nuxt, no `three`, no Node APIs — which is what lets the repository root test
them directly.

## 4. Not yet

No signing keys, no fleet credentials, no direct robot control, no OTA trigger
from the browser, and no safety-mode override. Those belong to the edge runtime
and the safety controller. The API enforces this rather than merely omitting it:
a request naming any world other than `aracnid` is refused with `422
E_LAB_WORLD_UNSUPPORTED`, and a task with no world model at all is refused with
`422 E_LAB_NO_WORLD` — it can be compiled and reviewed, never executed.

## 5. Verification log

Reproduce with the commands in README §Running it. What was observed on this
branch:

- `npm install` at the root, with `apps/virtual-lab` in `workspaces`: 644
  packages, no peer conflicts.
- `npm run typecheck --workspace apps/virtual-lab`: clean, after three fixes —
  the `#shared`-style relative depth in `server/api/missions/`, the removal of
  `future.compatibilityVersion`, and `allowedHosts` moving from `devServer` (not
  in its type) to `vite.server`.
- `npm run build --workspace apps/virtual-lab`: succeeds after the `app/shared/`
  move; 3.21 MB total, 804 kB gzipped, one warning that the `three` chunk is over
  500 kB.
- `node .output/server/index.mjs`: serves SSR HTML and the API, and resolves the
  repository's `dsl/` files from inside the bundle (the loader walks up from its
  own directory to find the schema, so no `serverAssets` copy is needed).
- Dev server, `POST /api/missions/run` for all eight scenarios: the outcomes in
  README §What a run shows, identical to the matrix
  `packages/engine/test/aracnid-mission.test.ts` pins; the same request twice
  returns the same run id, journal hash and mission time.
- `npm run verify` at the root: 180 tests across 16 files, including the lab's
  35, with the structure, link, grammar, type, lint and format gates green.
