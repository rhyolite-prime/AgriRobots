#pragma once

/**
 * Trace and IR hashing — the equivalence contract with the reference engine.
 *
 * `packages/engine/src/journal.ts` exports `canonicalTraceOf()` and `hash()`,
 * and `packages/compiler-core/src/lang/ir.ts` exports `canonicalJson()` and
 * `sha256Hex()`. Those four functions decide whether a run recorded on a robot
 * and the same run replayed in the Virtual Lab are the same run. These are their
 * C++ counterparts, and `engine/testdata/traces/` holds the fixtures that prove
 * the two agree.
 */

#include <array>
#include <string>
#include <string_view>

#include "agri/canonical_json.hpp"

namespace agri {

/**
 * The fields `hash()` projects from each journal event, in the order it writes
 * them.
 *
 * Everything else an event carries — `schemaVersion`, `runId`, `monotonicNs` —
 * is deliberately absent. The hash covers the audit-relevant projection, so a
 * port that hashed whole events would never reproduce it.
 */
inline constexpr std::array<std::string_view, 9> kJournalProjection = {
    "configuration", "eventId",  "kind",    "payload", "quality",
    "safetyState",   "sequence", "source",  "timestamp"};

/**
 * The canonical bytes a trace hash is taken over: a JSON array of the projected
 * events, with `payload` keys sorted recursively and `configuration` keys left in
 * the order the engine wrote them.
 *
 * A field an event does not carry is JavaScript's `undefined`, which
 * `JSON.stringify` drops, so its key must not appear here either.
 */
[[nodiscard]] std::string canonicalTraceOf(const Json& events);

/** `sha256Hex(canonicalTraceOf(events))` — `MissionResult.journalHash`. */
[[nodiscard]] std::string journalHash(const Json& events);

/** The IR's canonical form: every object key sorted, recursively. */
[[nodiscard]] std::string irCanonicalJson(const Json& ir);

/** `sha256Hex(irCanonicalJson(ir))` — the `irHash` a signed artifact carries. */
[[nodiscard]] std::string irHash(const Json& ir);

} // namespace agri
