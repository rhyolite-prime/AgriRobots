#include "agri/trace.hpp"

#include "agri/error.hpp"
#include "agri/sha256.hpp"

namespace agri {

std::string canonicalTraceOf(const Json& events) {
  if (!events.is_array()) {
    throw AgriEngineError("E_MISSION_INPUT", "journal events must be a JSON array");
  }

  std::string out;
  out.push_back('[');
  bool firstEvent = true;

  for (const auto& event : events) {
    if (!event.is_object()) {
      throw AgriEngineError("E_MISSION_INPUT", "a journal event must be a JSON object");
    }
    if (!firstEvent) {
      out.push_back(',');
    }
    firstEvent = false;

    out.push_back('{');
    bool firstField = true;
    for (const std::string_view field : kJournalProjection) {
      const auto found = event.find(std::string(field));
      if (found == event.end()) {
        // Absent means `undefined` in the reference engine, and JSON.stringify
        // drops it: the key must not be written at all, not even as null.
        continue;
      }
      if (!firstField) {
        out.push_back(',');
      }
      firstField = false;

      writeJsonString(out, field);
      out.push_back(':');
      // sortDeep() sorts payload keys; configuration keeps run order.
      const KeyOrder order = field == "payload" ? KeyOrder::Sorted : KeyOrder::Insertion;
      out += stringify(*found, order);
    }
    out.push_back('}');
  }

  out.push_back(']');
  return out;
}

std::string journalHash(const Json& events) { return sha256Hex(canonicalTraceOf(events)); }

std::string irCanonicalJson(const Json& ir) { return canonicalJson(ir); }

std::string irHash(const Json& ir) { return sha256Hex(canonicalJson(ir)); }

} // namespace agri
