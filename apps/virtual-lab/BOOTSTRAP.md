# Bootstrapping the Virtual Lab

Run these steps once, in a single change set, and keep the result reviewable.

## 1. Create the application

```bash
npx nuxi@latest init apps/virtual-lab --packageManager npm --gitInit false
```

Then add `"apps/virtual-lab"` to the `workspaces` array in the root
`package.json`, and pin the dependencies the plan requires:

```bash
npm install --workspace apps/virtual-lab nuxt vue vue-router
npm install --workspace apps/virtual-lab @tresjs/core three
npm install --workspace apps/virtual-lab \
  @agrirobots/contracts @agrirobots/domain-model \
  @agrirobots/compiler-core @agrirobots/policy
```

## 2. Minimum first increment

1. A page that lists AP-01, UCI-01 and the four cassettes from
   `@agrirobots/domain-model`.
2. A Three.js/TresJS viewport that loads one reference GLTF/URDF asset and shows
   the `map → odom → base_link → cassette_link → tool_link` frames.
3. A manifest panel that runs `validateModuleManifest()` and prints every
   rejection reason.
4. A recipe panel that runs `parseRecipeYaml()` + `validateRecipeDocument()` on
   `dsl/examples/poultry-evening-feed.yaml` and shows the errors verbatim.
5. A capability panel that runs `checkRecipeRequires()` and
   `checkReleaseReadiness()` and shows the gate/approval explanation.

Everything above runs on committed repository data, with no robot, no cloud
service and no secrets. That is the acceptance bar for the first Virtual Lab
merge.

## 3. Configuration requirements

- `nuxt.config.ts` must set `ssr: false` or a Node server that binds `0.0.0.0`
  and permits the preview/dev origin; hard-coded `localhost` API calls from the
  browser are not acceptable.
- Add `.nuxt/`, `.output/` and any generated asset cache to `.gitignore` (already
  present at the repository root).
- The app must not read files outside the repository through user input; recipe
  and asset loading goes through an explicit, validated path list.

## 4. Not yet

No signing keys, no fleet credentials, no direct robot control, no OTA trigger
from the browser, and no safety-mode override. Those belong to the edge runtime
and the safety controller.
