#include <catch_amalgamated.hpp>

#include <string>
#include <vector>

#include <agri/canonical_json.hpp>
#include <agri/sha256.hpp>
#include <agri/trace.hpp>

#include "test_support.hpp"

using agri::Json;
using agri::KeyOrder;
using agri::canonicalTraceOf;
using agri::irCanonicalJson;
using agri::irHash;
using agri::journalHash;
using agri::sha256Hex;
using agri::stringify;
using agri::test::fixtureNames;
using agri::test::readFixture;

namespace {

constexpr char kNominalFixture[] = "traces/aracnid-nominal-seed7-arc.json";

/** The hash `docs/09` and the Virtual Lab quote for the nominal ARACNID round. */
constexpr char kNominalJournalHash[] =
    "ca0008e7fbb31f68a1a6df16e1fc4e1630679e418f22e27419bec1dfbfbab90e";

/** The hash `packages/policy/test/agri-task-compile.test.ts` pins for the same task. */
constexpr char kAracnidIrHash[] =
    "4f35636c61653393438b5e3532ff5306340a40677a4f6a10757be3be61fc498c";

/** Every trace fixture the reference engine generates. */
const std::vector<std::string>& expectedFixtures() {
  static const std::vector<std::string> names = {
      "aracnid-fewer-eggs-seed7-arc.json",
      "aracnid-nominal-seed7-arc.json",
      "aracnid-nominal-seed7-straight.json",
      "aracnid-tilt-breach-seed7-arc.json",
      "probe-permit-and-verify.json",
  };
  return names;
}

} // namespace

TEST_CASE("the suite reads every trace fixture that exists", "[golden]") {
  // A new fixture that no test opens would be a silent hole in the contract.
  CHECK(fixtureNames("traces") == expectedFixtures());
  CHECK(fixtureNames("vectors") == std::vector<std::string>{"canonical-json.json", "numbers.json"});
}

TEST_CASE("every golden trace hashes identically in C++ and TypeScript", "[golden]") {
  for (const std::string& name : expectedFixtures()) {
    const std::string relative = "traces/" + name;
    DYNAMIC_SECTION(relative) {
      const Json fixture = readFixture(relative);
      const Json& journal = fixture.at("journal");
      const Json& events = journal.at("events");
      REQUIRE(events.is_array());
      REQUIRE_FALSE(events.empty());
      CHECK(events.size() == journal.at("eventCount").get<std::size_t>());

      // The events carry more than the projection hashes, which is the point.
      CHECK(events.front().contains("schemaVersion"));
      CHECK(events.front().contains("runId"));

      CHECK(journalHash(events) == journal.at("journalHash").get<std::string>());

      const Json& ir = fixture.at("ir");
      CHECK(irHash(ir.at("value")) == ir.at("irHash").get<std::string>());

      // Where the reference engine also committed the bytes, compare bytes: a
      // hash agreement alone could hide a writer difference that cancels out.
      if (journal.contains("canonicalTrace")) {
        CHECK(canonicalTraceOf(events) == journal.at("canonicalTrace").get<std::string>());
      }
      if (ir.contains("canonicalJson")) {
        CHECK(irCanonicalJson(ir.at("value")) == ir.at("canonicalJson").get<std::string>());
      }
    }
  }
}

TEST_CASE("the nominal ARACNID round reproduces the published hashes", "[golden]") {
  const Json fixture = readFixture(kNominalFixture);
  const Json& events = fixture.at("journal").at("events");

  CHECK(fixture.at("journal").at("journalHash").get<std::string>() == kNominalJournalHash);
  CHECK(journalHash(events) == kNominalJournalHash);
  CHECK(fixture.at("ir").at("irHash").get<std::string>() == kAracnidIrHash);
  CHECK(irHash(fixture.at("ir").at("value")) == kAracnidIrHash);
  CHECK(events.size() == 297);
  CHECK(fixture.at("run").at("status").get<std::string>() == "completed");
  CHECK(fixture.at("run").at("exitCode").get<int>() == 0);
}

TEST_CASE("the projection drops what the reference engine drops", "[golden]") {
  const Json fixture = readFixture(kNominalFixture);
  const std::string canonical = canonicalTraceOf(fixture.at("journal").at("events"));

  CHECK(canonical.find("schemaVersion") == std::string::npos);
  CHECK(canonical.find("monotonicNs") == std::string::npos);
  CHECK(canonical.find("\"runId\":") == std::string::npos);

  // The run id survives only inside each eventId, as "<runId>:<6 digits>".
  CHECK(canonical.find("\"eventId\":\"lab-aracnid-egg-collection-nominal-7-arc:") != std::string::npos);
  // Every one of the nine projected fields is present.
  for (const std::string_view field : agri::kJournalProjection) {
    INFO("field " << field);
    // Built in steps: GCC's -Wrestrict misreads rvalue string concatenation here.
    std::string needle("\"");
    needle += field;
    needle += "\":";
    CHECK(canonical.find(needle) != std::string::npos);
  }
}

TEST_CASE("configuration keeps run order while payload is sorted", "[golden]") {
  const Json fixture = readFixture(kNominalFixture);
  const Json& events = fixture.at("journal").at("events");
  const Json& configuration = events.front().at("configuration");

  // Insertion order starts with the carrier, as configurationOf() writes it.
  CHECK(stringify(configuration, KeyOrder::Insertion).find("\"carrierId\":") == 1);

  // The two orders really do differ here, so the assertions below mean something.
  REQUIRE(stringify(configuration, KeyOrder::Insertion) != agri::canonicalJson(configuration));

  // recipeHash is written before mapRevision; alphabetically it would be after.
  const std::string canonical = canonicalTraceOf(events);
  const std::size_t recipe = canonical.find("\"recipeHash\":");
  const std::size_t mapRevision = canonical.find("\"mapRevision\":");
  REQUIRE(recipe != std::string::npos);
  REQUIRE(mapRevision != std::string::npos);
  CHECK(recipe < mapRevision);

  // Payload keys, by contrast, are sorted: a nested object inside a payload comes
  // back out in alphabetical order even though the engine built it in run order.
  for (const Json& event : events) {
    if (!event.contains("payload")) {
      continue;
    }
    const Json& payload = event.at("payload");
    if (payload.is_object() && !payload.empty()) {
      CHECK(stringify(payload, KeyOrder::Sorted) == agri::canonicalJson(payload));
      break;
    }
  }
}

TEST_CASE("a trace hash covers the whole run, not one event", "[golden]") {
  const Json fixture = readFixture(kNominalFixture);
  const Json events = fixture.at("journal").at("events");
  const std::string whole = journalHash(events);

  // Dropping the last event, or changing one field in it, changes the hash: the
  // journal is append-only and its hash is what makes that enforceable.
  Json truncated = events;
  truncated.erase(truncated.size() - 1);
  CHECK(journalHash(truncated) != whole);

  Json altered = events;
  altered[altered.size() - 1]["kind"] = "task.completed";
  CHECK(journalHash(altered) != whole);
}

TEST_CASE("canonical traces are stable across repeated hashing", "[golden]") {
  const Json fixture = readFixture("traces/probe-permit-and-verify.json");
  const Json& events = fixture.at("journal").at("events");
  const std::string first = canonicalTraceOf(events);
  CHECK(canonicalTraceOf(events) == first);
  CHECK(sha256Hex(first) == journalHash(events));
  CHECK(first == fixture.at("journal").at("canonicalTrace").get<std::string>());
}
