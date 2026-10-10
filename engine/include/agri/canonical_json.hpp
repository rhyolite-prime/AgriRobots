#pragma once

/**
 * Canonical JSON, byte for byte as the TypeScript reference engine writes it.
 *
 * This is not "JSON with sorted keys". Two different orders are in use, and the
 * hashes depend on both:
 *
 *  - `packages/compiler-core/src/lang/ir.ts` canonicalises the IR by sorting
 *    every object key recursively (`canonicalJson`).
 *  - `packages/engine/src/journal.ts` hashes a trace with `JSON.stringify`,
 *    which keeps insertion order — and the `configuration` block is written in
 *    run order, not alphabetically.
 *
 * On top of that, both orders are subject to a JavaScript rule most JSON
 * libraries do not have: integer-index keys ("0", "1", "10") are listed before
 * every other key, in ascending numeric order, no matter how they were inserted
 * or sorted. Numbers are printed by ECMAScript `Number::toString`, strings are
 * escaped exactly as `JSON.stringify` escapes them, and keys compare as UTF-16
 * code units, so an astral character sorts before U+E000..U+FFFF.
 *
 * `engine/testdata/vectors/` pins each of those rules against output produced by
 * the reference engine; `engine/testdata/traces/` pins whole runs.
 */

#include <nlohmann/json.hpp>

#include <string>
#include <string_view>

namespace agri {

/**
 * Insertion-ordered JSON. `nlohmann::json` stores object keys in a `std::map`,
 * which sorts them; that would silently destroy the distinction this file exists
 * to preserve.
 */
using Json = nlohmann::ordered_json;

/** The order object keys are written in. */
enum class KeyOrder {
  /** `JSON.stringify`: index keys hoisted, the rest in insertion order. */
  Insertion,
  /** `canonicalJson`/`sortDeep`: index keys hoisted, the rest sorted. */
  Sorted,
};

/** Parses strictly; malformed input throws `nlohmann::json`'s parse error. */
[[nodiscard]] Json parseJson(std::string_view text);

/**
 * ECMAScript `Number::toString(10)` for a finite double: the shortest digits
 * that round-trip, placed by the specification's four cases. Throws
 * `E_NON_DETERMINISTIC` for NaN and infinity, which JSON cannot represent.
 */
[[nodiscard]] std::string numberToString(double value);

/** Writes `text` as a JSON string literal, including the quotes. */
void writeJsonString(std::string& out, std::string_view text);

/** `writeJsonString` into a fresh string. */
[[nodiscard]] std::string quoteJson(std::string_view text);

/** True when `key` is an ECMAScript array-index property name. */
[[nodiscard]] bool isArrayIndexKey(std::string_view key);

/** Compares UTF-8 strings as sequences of UTF-16 code units, as `Array.prototype.sort` does. */
[[nodiscard]] int compareUtf16(std::string_view left, std::string_view right);

/** Serialises `value` with no insignificant whitespace, in the given key order. */
[[nodiscard]] std::string stringify(const Json& value, KeyOrder order);

/** `stringify(value, KeyOrder::Sorted)`: the IR's canonical form. */
[[nodiscard]] std::string canonicalJson(const Json& value);

} // namespace agri
