# `engine/` — the C++ execution engine

This is the engine the robots run. It is C++23, it has no ROS dependency, and it
has no network dependency: everything it needs to build is in this directory.

The TypeScript engine in [`packages/engine`](../packages/engine/README.md) is the
**reference implementation**. It is what the Virtual Lab executes, what CI tests
most cheaply, and what this directory is measured against. Two engines exist
because they do different jobs — one runs on a robot with real-time constraints
and no Node.js, one runs in a browser studio and a CI runner — and they are held
together by one rule: **for the same signed task and the same run, both produce
byte-identical canonical bytes and therefore identical hashes.**

`docs/09_DSL_AND_EXECUTION_ENGINE.md` §7 states that contract and §12 records the
decision to build it this way.

> **Name collision, on purpose.** `engine/` is this C++ tree (CMake project
> `agri-engine`). `packages/engine` is the TypeScript reference twin. They are not
> the same thing and neither is a build of the other. If that ever costs more than
> it saves, the C++ tree is the one to rename.

## What is implemented here

The equivalence foundation, and nothing else yet. Everything in this increment
exists because a hash that differs by one byte between the two engines makes
every later comparison meaningless.

| Component | Header | Mirrors |
| --- | --- | --- |
| SHA-256 (FIPS 180-4), self-contained | `include/agri/sha256.hpp` | `sha256Hex()` in `packages/compiler-core/src/lang/ir.ts` |
| Canonical JSON writer, both key orders | `include/agri/canonical_json.hpp` | `canonicalJson()` in `ir.ts`, `JSON.stringify` in `journal.ts` |
| Trace and IR hashing | `include/agri/trace.hpp` | `canonicalTraceOf()` and `hash()` in `packages/engine/src/journal.ts` |
| Error type and codes | `include/agri/error.hpp` | `AgriScriptError` codes in `packages/compiler-core` |

Not here yet, in the order `docs/09` §11 sequences them: the statement
interpreter over signed IR, the permit and safety-gate model, degraded modes,
checkpoint/resume, artifact signature verification, and the ROS 2 Jazzy bridge
that will live in `ros_ws/src/agri_executor` and link `agri::engine`. The robot
never parses AgriScript text — it receives signed canonical IR — so no lexer or
parser belongs in this tree.

## Build and test

CMake ≥ 3.25 and a C++23 compiler (GCC 12+ or Clang 16+).

```sh
cmake -S engine -B engine/build -DCMAKE_BUILD_TYPE=Release
cmake --build engine/build -j"$(nproc)"
ctest --test-dir engine/build --output-on-failure
```

`engine/build/` is git-ignored. Options:

| Option | Default | Effect |
| --- | --- | --- |
| `AGRI_ENGINE_BUILD_TESTS` | `ON` | Build the Catch2 equivalence suite |
| `AGRI_ENGINE_WERROR` | `OFF` | Warnings are errors; CI builds with it `ON` |
| `AGRI_ENGINE_INSTALL` | `ON` | Install rules, so the ROS 2 executor can link `agri::engine` |

Two ctest entries: `agri_engine_unit` (SHA-256 and canonicalisation vectors) and
`agri_engine_golden_traces` (whole runs). A sanitizer run is worth doing before
any change to the writer:

```sh
cmake -S engine -B engine/build/san -DCMAKE_BUILD_TYPE=Debug \
  -DCMAKE_CXX_FLAGS="-fsanitize=address,undefined -fno-sanitize-recover=all"
cmake --build engine/build/san -j"$(nproc)" && ctest --test-dir engine/build/san
```

## The canonicalisation contract

These are the rules the two engines agree on. Each one is pinned by a fixture in
[`testdata/`](testdata/README.md), and each one is a way a port can be silently
wrong.

1. **There are two key orders, not one.** `canonicalJson()` sorts every object key
   recursively. `JSON.stringify` does not sort at all, and `journal.ts` uses it
   directly — so the journal's `configuration` block is written in the order
   `configurationOf()` builds it (`carrierId`, `cassetteSerial`, `recipeHash`,
   `mapRevision`, `modelVersion`, `calibrationBundleHash`, then the caller's
   overrides), which is not alphabetical. `KeyOrder::Insertion` and
   `KeyOrder::Sorted` are therefore both load-bearing.
2. **Only `payload` is sorted inside an event.** `sortDeep()` is applied to the
   payload and to nothing else.
3. **Integer-index keys hoist.** JavaScript lists keys `"0"`, `"2"`, `"10"` before
   every other key, in ascending numeric order, regardless of insertion — and it
   does so again when a sorted copy is built, so the *sorted* order reads `"0"`,
   `"1"`, `"2"`, `"10"`, `"-1"`, `"01"`, `"1.0"`, `"a"`, `"b"`. An index key is a
   canonical decimal string in `[0, 2^32 − 2]`; `"-1"`, `"01"` and `"1.0"` are not
   index keys.
4. **Keys compare as UTF-16 code units**, not code points: U+1F600 (`D83D DE00`)
   sorts before U+FFFF.
5. **Arrays are never reordered.** The order of a trace is its meaning.
6. **Numbers print as ECMAScript `Number::toString(10)`**: shortest round-trip
   digits, then the specification's four placements — digits plus zeros for
   `k ≤ n ≤ 21`, a decimal point for `0 < n ≤ 21`, `0.` and zeros for
   `−6 < n ≤ 0`, and `d[.ddd]e±(n−1)` otherwise. So `1e+21`, `1e-7`, `5e-324`,
   `0.000001` and `123456789012345680000` are all correct output and none of them
   is what `printf("%g")` produces.
7. **`-0` prints as `0`**, and an integer past 2^53 is rounded to the nearest
   double *before* printing, because JavaScript has no other number type.
8. **Escaping is minimal**: `"`, `\`, `\b`, `\t`, `\n`, `\f`, `\r`, other C0 as
   lowercase `\u00xx`. DEL, U+2028, U+2029 and every non-ASCII character are
   written raw as UTF-8.
9. **The hash covers a projection.** Each event contributes exactly nine fields in
   this order: `configuration`, `eventId`, `kind`, `payload`, `quality`,
   `safetyState`, `sequence`, `source`, `timestamp`. The `schemaVersion`, `runId`
   and `monotonicNs` that events also carry are excluded. A field an event does
   not carry is `undefined`, which `JSON.stringify` drops, so its key must not
   appear — not even as `null`.
10. **`eventId` is `<runId>:<sequence padded to six digits>`**, which is why the
    run id changes the trace hash: the same events under a different run id are a
    different trace.
11. **A value with no finite decimal form is refused**, not approximated: NaN and
    infinity raise `E_NON_DETERMINISTIC`, the same code the reference engine uses
    (rule S10).
12. **The digest is lowercase hex SHA-256** over those bytes, with no trailing
    newline.

## Fixtures

`testdata/` is generated by the reference engine and committed. To regenerate
after an intentional change to either engine:

```sh
npm run export:golden   # writes engine/testdata/
npm run verify          # the drift gate must pass
```

Never edit a fixture by hand. `packages/engine/test/golden-traces.test.ts`
regenerates every fixture in memory on each run and fails on the first differing
byte, so a hand edit does not survive CI — and if a hash legitimately changed, the
fixture, the C++ suite and whatever `docs/09` quotes must all change in the same
commit.

## Dependencies

Vendored in [`third_party/`](third_party/README.md): nlohmann/json 3.12.0 (MIT)
and Catch2 3.16.1 (BSL-1.0). Nothing is fetched at configure time, so a build
machine with no network produces the same binary as one with a network.
