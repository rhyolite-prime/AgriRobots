# `engine/third_party/` — vendored C++ dependencies

Two libraries, both vendored as single files, both pinned by SHA-256.

| Library | Version | Files | License | Upstream |
| --- | --- | --- | --- | --- |
| nlohmann/json | 3.12.0 | `nlohmann/json.hpp` | MIT | <https://github.com/nlohmann/json> |
| Catch2 | 3.16.1 | `catch2/catch_amalgamated.hpp`, `catch2/catch_amalgamated.cpp` | BSL-1.0 | <https://github.com/catchorg/Catch2> |

```
aaf127c04cb31c406e5b04a63f1ae89369fccde6d8fa7cdda1ed4f32dfc5de63  nlohmann/json.hpp
f354576b9fe94f110dc4cc2210e6288c8d4915132f9ff97a57e61798eb9ad541  catch2/catch_amalgamated.hpp
51cbc6feeb16cdc8f37d757161526983409b4a82f96463f886e65528a2eff39b  catch2/catch_amalgamated.cpp
```

Verify with `sha256sum engine/third_party/nlohmann/json.hpp
engine/third_party/catch2/catch_amalgamated.*`.

## Why vendored rather than fetched

- **A robot image builds offline.** `FetchContent`, `find_package` and Conan all
  assume a network or a populated cache at configure time. The engine has to build
  on a bench machine with no route to the internet, and in a CI runner that should
  not have one.
- **Reproducibility is a safety argument, not a convenience.** The hashes in
  `testdata/` are taken over bytes produced by this code. If the JSON writer's
  behaviour could change between builds because a dependency resolved differently,
  a signed artifact would not mean what it says.
- **No package manager on the target.** The robot runs a minimal image; a
  system-installed nlohmann/json of unknown vintage is exactly the kind of
  unknown this directory exists to remove.

Both files are used as-is, unmodified. They are included as `SYSTEM` headers in
`engine/CMakeLists.txt`, so their warnings are neither this repository's to fix
nor able to break a `-Werror` build.

## What each is for

- **nlohmann/json** — parsing fixtures and holding IR and journal values. The
  engine uses `nlohmann::ordered_json` (`agri::Json`) throughout, never
  `nlohmann::json`: the default type stores object keys in a `std::map`, which
  sorts them and would destroy the insertion order the journal hash depends on.
- **Catch2** — the equivalence test suite, tests only, never linked into anything
  that runs on a robot. The amalgamated source provides `main()`, so the suite has
  no `test_main.cpp`; define `CATCH_AMALGAMATED_CUSTOM_MAIN` on the `catch2`
  target if that ever needs to change.

## Updating a dependency

1. Download the release tarball, e.g.
   `https://codeload.github.com/nlohmann/json/tar.gz/refs/tags/v3.12.0`, and copy
   the single-header file into place. (`raw.githubusercontent.com` and release
   asset redirects are not reachable from every build environment; `codeload` is.)
2. Update the version and SHA-256 in this file.
3. Rebuild and run `ctest --test-dir engine/build`. The golden-trace suite is the
   check that matters: a dependency change that alters number formatting or key
   order fails there, not in review.
4. Confirm `scripts/check-tree.mjs` still passes — it refuses any tracked file of
   5 MB or more, which is the ceiling these single headers have to stay under.
5. Commit the dependency change on its own, so a hash change in `testdata/` and a
   dependency change are never confused with each other.
