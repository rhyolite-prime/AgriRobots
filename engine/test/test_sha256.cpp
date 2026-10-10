#include <catch_amalgamated.hpp>

#include <algorithm>
#include <array>
#include <cstdint>
#include <string>
#include <string_view>

#include <agri/sha256.hpp>

using agri::Sha256;
using agri::sha256Hex;

namespace {

/** Formats a digest, so streaming can be compared against the one-shot path. */
std::string hexOf(const std::array<std::uint8_t, 32>& digest) {
  static constexpr char kHexDigits[] = "0123456789abcdef";
  std::string out;
  out.reserve(digest.size() * 2);
  for (const std::uint8_t byte : digest) {
    out.push_back(kHexDigits[(byte >> 4) & 0x0fu]);
    out.push_back(kHexDigits[byte & 0x0fu]);
  }
  return out;
}

} // namespace

TEST_CASE("sha256 reproduces the published test vectors", "[sha256]") {
  // FIPS 180-4 / NIST SP 800-204.
  CHECK(sha256Hex("") == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  CHECK(sha256Hex("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  CHECK(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq") ==
        "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  CHECK(sha256Hex("The quick brown fox jumps over the lazy dog") ==
        "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592");
}

TEST_CASE("sha256 hashes a million repetitions", "[sha256]") {
  const std::string million(1'000'000, 'a');
  CHECK(sha256Hex(million) == "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
}

TEST_CASE("sha256 streaming equals sha256 one-shot at every padding boundary", "[sha256]") {
  const std::string text =
      "AgriRobots journals are append-only, so a trace hash is taken over bytes that never change.";
  for (std::size_t length = 0; length <= 200; ++length) {
    const std::string_view prefix(text.data(), std::min(length, text.size()));
    Sha256 streamed;
    // Feed it in awkward chunks that straddle the 55, 56, 63 and 64 byte edges.
    std::size_t offset = 0;
    for (std::size_t chunk = 1; offset < prefix.size(); chunk += 3) {
      const std::size_t take = std::min(chunk, prefix.size() - offset);
      streamed.update(prefix.substr(offset, take));
      offset += take;
    }
    INFO("length " << prefix.size());
    CHECK(hexOf(streamed.finalise()) == sha256Hex(prefix));
  }
}

TEST_CASE("sha256 finalise does not consume the running state", "[sha256]") {
  Sha256 hasher;
  hasher.update("abc");
  const std::array<std::uint8_t, 32> first = hasher.finalise();
  const std::array<std::uint8_t, 32> second = hasher.finalise();
  CHECK(hexOf(first) == sha256Hex("abc"));
  CHECK(hexOf(second) == sha256Hex("abc"));

  // Continuing after a finalise keeps hashing the same buffer, as a caller
  // writing a partial digest mid-run would expect.
  hasher.update("def");
  CHECK(hexOf(hasher.finalise()) == sha256Hex("abcdef"));
}

TEST_CASE("sha256 reset starts a new digest", "[sha256]") {
  Sha256 hasher;
  hasher.update("not part of the digest");
  hasher.reset();
  hasher.update("abc");
  CHECK(hexOf(hasher.finalise()) == sha256Hex("abc"));
}
