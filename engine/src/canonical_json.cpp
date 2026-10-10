#include "agri/canonical_json.hpp"

#include "agri/error.hpp"

#include <algorithm>
#include <array>
#include <charconv>
#include <cmath>
#include <cstdint>
#include <vector>

namespace agri {
namespace {

/** 2^53: the largest integer a JavaScript number holds exactly. */
constexpr std::int64_t kMaxExactInteger = 9007199254740992LL;

/** 2^32 - 2: the largest ECMAScript array index. */
constexpr std::uint64_t kMaxArrayIndex = 4294967294ULL;

constexpr char kHexDigits[] = "0123456789abcdef";

void writeValue(std::string& out, const Json& value, KeyOrder order);

void writeInteger(std::string& out, std::int64_t value) {
  // JavaScript has only doubles. An integer past 2^53 is rounded before it is
  // printed, so the same rounding has to happen here or a large counter would
  // hash differently on the robot than in the Virtual Lab.
  if (value > kMaxExactInteger || value < -kMaxExactInteger) {
    out += numberToString(static_cast<double>(value));
    return;
  }
  out += std::to_string(value);
}

void writeUnsigned(std::string& out, std::uint64_t value) {
  if (value > static_cast<std::uint64_t>(kMaxExactInteger)) {
    out += numberToString(static_cast<double>(value));
    return;
  }
  out += std::to_string(value);
}

/** Decodes UTF-8 into the UTF-16 code units JavaScript compares strings by. */
std::u16string toUtf16(std::string_view text) {
  std::u16string units;
  units.reserve(text.size());
  std::size_t index = 0;
  while (index < text.size()) {
    const auto lead = static_cast<unsigned char>(text[index]);
    std::uint32_t codePoint = 0;
    std::size_t length = 1;
    if (lead < 0x80) {
      codePoint = lead;
    } else if ((lead >> 5) == 0x6) {
      codePoint = lead & 0x1fu;
      length = 2;
    } else if ((lead >> 4) == 0xe) {
      codePoint = lead & 0x0fu;
      length = 3;
    } else if ((lead >> 3) == 0x1e) {
      codePoint = lead & 0x07u;
      length = 4;
    } else {
      throw AgriEngineError("E_MISSION_INPUT", "a JSON key is not valid UTF-8");
    }
    if (index + length > text.size()) {
      throw AgriEngineError("E_MISSION_INPUT", "a JSON key ends mid-character");
    }
    for (std::size_t step = 1; step < length; ++step) {
      const auto continuation = static_cast<unsigned char>(text[index + step]);
      if ((continuation >> 6) != 0x2) {
        throw AgriEngineError("E_MISSION_INPUT", "a JSON key is not valid UTF-8");
      }
      codePoint = (codePoint << 6) | (continuation & 0x3fu);
    }
    index += length;

    if (codePoint > 0xffff) {
      const std::uint32_t adjusted = codePoint - 0x10000;
      units.push_back(static_cast<char16_t>(0xd800u + (adjusted >> 10)));
      units.push_back(static_cast<char16_t>(0xdc00u + (adjusted & 0x3ffu)));
    } else {
      units.push_back(static_cast<char16_t>(codePoint));
    }
  }
  return units;
}

/**
 * Object keys in the order JavaScript lists them.
 *
 * Index keys come first in ascending numeric order and the rest follow, either
 * as inserted or sorted. The hoisting applies to the sorted order too: sorting
 * happens on the way into a fresh object, and a fresh object re-hoists, which is
 * why canonical JSON reads "0", "1", "2", "10", "-1", "01", "1.0", "a", "b".
 */
std::vector<std::string_view> objectKeys(const Json::object_t& object, KeyOrder order) {
  std::vector<std::string_view> indexed;
  std::vector<std::string_view> others;
  indexed.reserve(object.size());
  others.reserve(object.size());

  for (const auto& entry : object) {
    // ordered_map iteration yields std::pair, not the json_iterator with key().
    const std::string_view key(entry.first);
    if (isArrayIndexKey(key)) {
      indexed.push_back(key);
    } else {
      others.push_back(key);
    }
  }

  // Both are digit strings without leading zeros, so shorter means smaller.
  std::sort(indexed.begin(), indexed.end(), [](std::string_view left, std::string_view right) {
    return left.size() == right.size() ? left < right : left.size() < right.size();
  });

  if (order == KeyOrder::Sorted) {
    std::stable_sort(others.begin(), others.end(), [](std::string_view left, std::string_view right) {
      return compareUtf16(left, right) < 0;
    });
  }

  std::vector<std::string_view> keys;
  keys.reserve(indexed.size() + others.size());
  keys.insert(keys.end(), indexed.begin(), indexed.end());
  keys.insert(keys.end(), others.begin(), others.end());
  return keys;
}

void writeValue(std::string& out, const Json& value, KeyOrder order) {
  switch (value.type()) {
  case Json::value_t::null:
    out += "null";
    return;
  case Json::value_t::boolean:
    out += value.get<bool>() ? "true" : "false";
    return;
  case Json::value_t::number_integer:
    writeInteger(out, value.get<std::int64_t>());
    return;
  case Json::value_t::number_unsigned:
    writeUnsigned(out, value.get<std::uint64_t>());
    return;
  case Json::value_t::number_float:
    out += numberToString(value.get<double>());
    return;
  case Json::value_t::string:
    writeJsonString(out, value.get_ref<const Json::string_t&>());
    return;
  case Json::value_t::array: {
    out.push_back('[');
    bool first = true;
    for (const auto& element : value) {
      if (!first) {
        out.push_back(',');
      }
      first = false;
      writeValue(out, element, order);
    }
    out.push_back(']');
    return;
  }
  case Json::value_t::object: {
    const auto& object = value.get_ref<const Json::object_t&>();
    out.push_back('{');
    bool first = true;
    for (const std::string_view key : objectKeys(object, order)) {
      if (!first) {
        out.push_back(',');
      }
      first = false;
      writeJsonString(out, key);
      out.push_back(':');
      writeValue(out, object.at(std::string(key)), order);
    }
    out.push_back('}');
    return;
  }
  default:
    throw AgriEngineError("E_NON_DETERMINISTIC",
                          "cannot canonicalise a binary or discarded JSON value");
  }
}

} // namespace

Json parseJson(std::string_view text) { return Json::parse(text); }

std::string numberToString(double value) {
  if (std::isnan(value) || std::isinf(value)) {
    // The reference engine refuses these with the same code (ir.ts, rule S10):
    // a value with no finite decimal form has no reproducible hash.
    throw AgriEngineError("E_NON_DETERMINISTIC",
                          "cannot canonicalise a number that is NaN or infinite");
  }
  // JSON.stringify(-0) is "0".
  if (value == 0.0) {
    return "0";
  }

  std::string out;
  if (value < 0.0) {
    out.push_back('-');
    value = -value;
  }

  // Shortest digits that round-trip, in scientific form: d[.ddd]e±dd.
  std::array<char, 64> buffer{};
  const auto formatted = std::to_chars(buffer.data(), buffer.data() + buffer.size(), value,
                                       std::chars_format::scientific);
  if (formatted.ec != std::errc{}) {
    throw AgriEngineError("E_NON_DETERMINISTIC", "failed to format a number");
  }
  const std::string_view scientific(buffer.data(),
                                    static_cast<std::size_t>(formatted.ptr - buffer.data()));
  const std::size_t exponentAt = scientific.find('e');
  if (exponentAt == std::string_view::npos) {
    throw AgriEngineError("E_NON_DETERMINISTIC", "a formatted number has no exponent");
  }

  std::string digits;
  digits.reserve(scientific.size());
  for (std::size_t index = 0; index < exponentAt; ++index) {
    if (scientific[index] != '.') {
      digits.push_back(scientific[index]);
    }
  }

  std::string_view exponentText = scientific.substr(exponentAt + 1);
  if (!exponentText.empty() && exponentText.front() == '+') {
    // std::from_chars accepts a leading '-' but not a leading '+'.
    exponentText.remove_prefix(1);
  }
  int exponent = 0;
  const auto parsed =
      std::from_chars(exponentText.data(), exponentText.data() + exponentText.size(), exponent);
  if (parsed.ec != std::errc{}) {
    throw AgriEngineError("E_NON_DETERMINISTIC", "failed to read a formatted exponent");
  }

  const int significant = static_cast<int>(digits.size());
  const int position = exponent + 1;

  if (significant <= position && position <= 21) {
    out += digits;
    out.append(static_cast<std::size_t>(position - significant), '0');
  } else if (position > 0 && position <= 21) {
    out += digits.substr(0, static_cast<std::size_t>(position));
    out.push_back('.');
    out += digits.substr(static_cast<std::size_t>(position));
  } else if (position > -6 && position <= 0) {
    out += "0.";
    out.append(static_cast<std::size_t>(-position), '0');
    out += digits;
  } else {
    out.push_back(digits[0]);
    if (significant > 1) {
      out.push_back('.');
      out += digits.substr(1);
    }
    out.push_back('e');
    const int power = position - 1;
    out.push_back(power < 0 ? '-' : '+');
    out += std::to_string(power < 0 ? -power : power);
  }
  return out;
}

void writeJsonString(std::string& out, std::string_view text) {
  out.push_back('"');
  for (const char raw : text) {
    const auto byte = static_cast<unsigned char>(raw);
    switch (byte) {
    case static_cast<unsigned char>('"'):
      out += "\\\"";
      break;
    case static_cast<unsigned char>('\\'):
      out += "\\\\";
      break;
    case static_cast<unsigned char>('\b'):
      out += "\\b";
      break;
    case static_cast<unsigned char>('\t'):
      out += "\\t";
      break;
    case static_cast<unsigned char>('\n'):
      out += "\\n";
      break;
    case static_cast<unsigned char>('\f'):
      out += "\\f";
      break;
    case static_cast<unsigned char>('\r'):
      out += "\\r";
      break;
    default:
      if (byte < 0x20) {
        out += "\\u00";
        out.push_back(kHexDigits[(byte >> 4) & 0x0fu]);
        out.push_back(kHexDigits[byte & 0x0fu]);
      } else {
        // Everything else is written raw: JSON.stringify escapes neither DEL,
        // nor U+2028/U+2029, nor any non-ASCII character.
        out.push_back(raw);
      }
    }
  }
  out.push_back('"');
}

std::string quoteJson(std::string_view text) {
  std::string out;
  out.reserve(text.size() + 2);
  writeJsonString(out, text);
  return out;
}

bool isArrayIndexKey(std::string_view key) {
  if (key.empty() || key.size() > 10) {
    return false;
  }
  if (key.front() == '0') {
    // "0" is canonical; "01" and "007" are not, so they sort as ordinary strings.
    return key == "0";
  }
  std::uint64_t value = 0;
  for (const char character : key) {
    if (character < '0' || character > '9') {
      return false;
    }
    value = value * 10 + static_cast<std::uint64_t>(character - '0');
  }
  return value <= kMaxArrayIndex;
}

int compareUtf16(std::string_view left, std::string_view right) {
  const std::u16string leftUnits = toUtf16(left);
  const std::u16string rightUnits = toUtf16(right);
  if (leftUnits < rightUnits) {
    return -1;
  }
  if (leftUnits > rightUnits) {
    return 1;
  }
  return 0;
}

std::string stringify(const Json& value, KeyOrder order) {
  std::string out;
  writeValue(out, value, order);
  return out;
}

std::string canonicalJson(const Json& value) { return stringify(value, KeyOrder::Sorted); }

} // namespace agri
