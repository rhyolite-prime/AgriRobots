#include <catch_amalgamated.hpp>

#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <iomanip>
#include <sstream>
#include <string>
#include <string_view>

#include <agri/canonical_json.hpp>
#include <agri/error.hpp>

#include "test_support.hpp"

using agri::Json;
using agri::KeyOrder;
using agri::canonicalJson;
using agri::compareUtf16;
using agri::isArrayIndexKey;
using agri::numberToString;
using agri::parseJson;
using agri::quoteJson;
using agri::stringify;
using agri::test::readFixture;

namespace {

/** The IEEE-754 bit pattern, in the form the fixture writes it. */
std::string bitsOf(double value) {
  std::uint64_t raw = 0;
  std::memcpy(&raw, &value, sizeof(raw));
  std::ostringstream out;
  out << "0x" << std::hex << std::setfill('0') << std::setw(16) << raw;
  return out.str();
}

} // namespace

TEST_CASE("numbers print exactly as JSON.stringify prints them", "[canonical][vectors]") {
  const Json fixture = readFixture("vectors/numbers.json");
  const Json& cases = fixture.at("cases");
  REQUIRE(cases.is_array());
  REQUIRE(cases.size() >= 40);

  for (const Json& vector : cases) {
    const std::string expected = vector.at("json").get<std::string>();
    const std::string document = vector.at("document").get<std::string>();
    INFO("case " << vector.at("index").get<int>() << ": " << expected);

    // The number on its own, and the same number inside a document.
    const double value = parseJson(expected).get<double>();
    CHECK(numberToString(value) == expected);

    const Json parsedDocument = parseJson(document);
    CHECK(stringify(parsedDocument, KeyOrder::Insertion) == document);

    if (vector.at("roundTripsBits").get<bool>()) {
      // The parse landed on the double the reference engine had, so an agreement
      // cannot be two parsers being wrong in the same way.
      CHECK(bitsOf(value) == vector.at("bits").get<std::string>());
      CHECK(bitsOf(parsedDocument.at("value").get<double>()) ==
            vector.at("bits").get<std::string>());
    } else {
      // Only -0 lands here: JSON.stringify writes it as "0", and so must we.
      CHECK(expected == "0");
    }
  }
}

TEST_CASE("canonical JSON reproduces both key orders", "[canonical][vectors]") {
  const Json fixture = readFixture("vectors/canonical-json.json");
  const Json& cases = fixture.at("cases");
  REQUIRE(cases.is_array());
  REQUIRE(cases.size() >= 10);

  for (const Json& vector : cases) {
    // Parsed from raw text, so the input's key order is the one the fixture set.
    const Json parsed = parseJson(vector.at("inputText").get<std::string>());
    INFO("case " << vector.at("index").get<int>() << ": " << vector.at("name").get<std::string>());
    CHECK(stringify(parsed, KeyOrder::Insertion) == vector.at("stringify").get<std::string>());
    CHECK(canonicalJson(parsed) == vector.at("canonical").get<std::string>());
  }
}

TEST_CASE("negative zero prints as zero", "[canonical]") {
  // The one number whose JSON text does not determine its bit pattern.
  CHECK(numberToString(-0.0) == "0");
  CHECK(numberToString(std::numeric_limits<double>::denorm_min() * -0.0) == "0");
  CHECK(stringify(parseJson("{\"value\":-0}"), KeyOrder::Insertion) == "{\"value\":0}");
}

TEST_CASE("integer-index keys hoist ahead of every other key", "[canonical]") {
  const Json parsed = parseJson("{\"b\":1,\"10\":2,\"2\":3,\"-1\":4,\"01\":5,\"a\":6,\"0\":7}");
  // Hoisted keys first in numeric order ("10" before "2" would be wrong), then
  // the rest as inserted, or sorted by UTF-16 code unit.
  CHECK(stringify(parsed, KeyOrder::Insertion) ==
        "{\"0\":7,\"2\":3,\"10\":2,\"b\":1,\"-1\":4,\"01\":5,\"a\":6}");
  CHECK(canonicalJson(parsed) == "{\"0\":7,\"2\":3,\"10\":2,\"-1\":4,\"01\":5,\"a\":6,\"b\":1}");
}

TEST_CASE("isArrayIndexKey follows the ECMAScript definition", "[canonical]") {
  CHECK(isArrayIndexKey("0"));
  CHECK(isArrayIndexKey("7"));
  CHECK(isArrayIndexKey("10"));
  CHECK(isArrayIndexKey("4294967294"));
  CHECK_FALSE(isArrayIndexKey("4294967295")); // 2^32 - 1 is out of range
  CHECK_FALSE(isArrayIndexKey("4294967296"));
  CHECK_FALSE(isArrayIndexKey("-1"));
  CHECK_FALSE(isArrayIndexKey("01"));
  CHECK_FALSE(isArrayIndexKey("1.0"));
  CHECK_FALSE(isArrayIndexKey("1e2"));
  CHECK_FALSE(isArrayIndexKey(" 1"));
  CHECK_FALSE(isArrayIndexKey("1 "));
  CHECK_FALSE(isArrayIndexKey(""));
  CHECK_FALSE(isArrayIndexKey("99999999999")); // 11 digits cannot be an index
}

TEST_CASE("keys compare as UTF-16 code units, not code points", "[canonical]") {
  CHECK(compareUtf16("a", "a") == 0);
  CHECK(compareUtf16("a", "b") < 0);
  CHECK(compareUtf16("", "a") < 0);
  CHECK(compareUtf16("a", "ab") < 0);
  CHECK(compareUtf16("B", "a") < 0); // ASCII uppercase sorts before lowercase

  // U+1F600 is D83D DE00 in UTF-16, so it sorts before U+FFFF even though its
  // code point is larger. A code-point comparison gets this backwards.
  const std::string emoji = "\U0001F600";
  const std::string privateUse = "\xEF\xBF\xBF"; // U+FFFF in UTF-8
  CHECK(compareUtf16(emoji, privateUse) < 0);
  CHECK(compareUtf16(privateUse, emoji) > 0);

  const Json parsed = parseJson("{\"\xEF\xBF\xBF\":1,\"" + emoji + "\":2,\"z\":3,\"a\":4}");
  CHECK(canonicalJson(parsed) == "{\"a\":4,\"z\":3,\"" + emoji + "\":2,\"\xEF\xBF\xBF\":1}");
}

TEST_CASE("insertion order is preserved and sorting is recursive", "[canonical]") {
  Json value = Json::object();
  value["zebra"] = 1;
  value["apple"] = Json::object();
  value["apple"]["y"] = 2;
  value["apple"]["x"] = Json::array({3, Json::object({{"b", 4}, {"a", 5}})});
  value["mango"] = true;

  CHECK(stringify(value, KeyOrder::Insertion) ==
        "{\"zebra\":1,\"apple\":{\"y\":2,\"x\":[3,{\"b\":4,\"a\":5}]},\"mango\":true}");
  CHECK(canonicalJson(value) ==
        "{\"apple\":{\"x\":[3,{\"a\":5,\"b\":4}],\"y\":2},\"mango\":true,\"zebra\":1}");
  // Arrays are never reordered: an execution trace's order is its meaning.
  CHECK(canonicalJson(parseJson("[9,1,5]")).compare("[9,1,5]") == 0);
}

TEST_CASE("strings escape exactly as JSON.stringify escapes", "[canonical]") {
  CHECK(quoteJson("") == "\"\"");
  CHECK(quoteJson("plain") == "\"plain\"");
  CHECK(quoteJson("a\"b\\c") == "\"a\\\"b\\\\c\"");
  CHECK(quoteJson("\b\t\n\f\r") == "\"\\b\\t\\n\\f\\r\"");
  CHECK(quoteJson(std::string("\x00\x1f", 2)) == "\"\\u0000\\u001f\"");
  CHECK(quoteJson(std::string("\x7f", 1)) == "\"\x7f\"");       // DEL stays raw
  CHECK(quoteJson("\xE2\x80\xA8\xE2\x80\xA9") == "\"\xE2\x80\xA8\xE2\x80\xA9\""); // so do the line separators
  CHECK(quoteJson("caf\xC3\xA9 \U0001F95A") == "\"caf\xC3\xA9 \U0001F95A\"");      // and every non-ASCII byte
}

TEST_CASE("integers beyond 2^53 round the way a JavaScript number rounds", "[canonical]") {
  Json value = Json::object();
  value["exact"] = 9007199254740992LL;       // 2^53 is representable
  value["even"] = 9007199254740994LL;        // and so is the next even integer
  value["rounded"] = 1234567890123456789LL;  // this one is not: it lands on a multiple of 128
  value["huge"] = 18446744073709551615ULL;   // nor is the largest unsigned 64-bit integer
  CHECK(stringify(value, KeyOrder::Insertion) ==
        "{\"exact\":9007199254740992,\"even\":9007199254740994,"
        "\"rounded\":1234567890123456800,\"huge\":18446744073709552000}");
}

TEST_CASE("a value with no finite decimal form is refused", "[canonical]") {
  const double notANumber = std::nan("");
  const double infinity = std::numeric_limits<double>::infinity();
  for (const double value : {notANumber, infinity, -infinity}) {
    try {
      const std::string written = numberToString(value);
      FAIL("expected a refusal, got " << written);
    } catch (const agri::AgriEngineError& error) {
      // The reference engine refuses these under the same code (ir.ts, rule S10).
      CHECK(error.code() == "E_NON_DETERMINISTIC");
    }
  }
}
