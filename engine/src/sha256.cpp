#include "agri/sha256.hpp"

#include <algorithm>
#include <cstring>

namespace agri {
namespace {

/** First 32 bits of the fractional parts of the cube roots of the first 64 primes. */
constexpr std::array<std::uint32_t, 64> kRoundConstants = {
    0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu, 0x59f111f1u, 0x923f82a4u,
    0xab1c5ed5u, 0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u, 0x72be5d74u, 0x80deb1feu,
    0x9bdc06a7u, 0xc19bf174u, 0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu, 0x2de92c6fu,
    0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau, 0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u,
    0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u, 0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu,
    0x53380d13u, 0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u, 0xa2bfe8a1u, 0xa81a664bu,
    0xc24b8b70u, 0xc76c51a3u, 0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u, 0x19a4c116u,
    0x1e376c08u, 0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
    0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u, 0x90befffau, 0xa4506cebu, 0xbef9a3f7u,
    0xc67178f2u};

inline std::uint32_t rotateRight(std::uint32_t value, int bits) noexcept {
  return (value >> bits) | (value << (32 - bits));
}

inline std::uint32_t loadBigEndian32(const std::uint8_t* bytes) noexcept {
  return (static_cast<std::uint32_t>(bytes[0]) << 24) | (static_cast<std::uint32_t>(bytes[1]) << 16) |
         (static_cast<std::uint32_t>(bytes[2]) << 8) | static_cast<std::uint32_t>(bytes[3]);
}

inline void storeBigEndian32(std::uint8_t* bytes, std::uint32_t value) noexcept {
  bytes[0] = static_cast<std::uint8_t>(value >> 24);
  bytes[1] = static_cast<std::uint8_t>(value >> 16);
  bytes[2] = static_cast<std::uint8_t>(value >> 8);
  bytes[3] = static_cast<std::uint8_t>(value);
}

constexpr char kHexDigits[] = "0123456789abcdef";

} // namespace

void Sha256::reset() noexcept {
  state_ = {0x6a09e667u, 0xbb67ae85u, 0x3c6ef372u, 0xa54ff53au,
            0x510e527fu, 0x9b05688cu, 0x1f83d9abu, 0x5be0cd19u};
  bits_ = 0;
  buffered_ = 0;
}

void Sha256::transform(const std::uint8_t* block) noexcept {
  std::array<std::uint32_t, 64> schedule{};
  for (int index = 0; index < 16; ++index) {
    schedule[static_cast<std::size_t>(index)] = loadBigEndian32(block + static_cast<std::size_t>(index) * 4);
  }
  for (int index = 16; index < 64; ++index) {
    const std::uint32_t previous = schedule[static_cast<std::size_t>(index) - 15];
    const std::uint32_t older = schedule[static_cast<std::size_t>(index) - 2];
    const std::uint32_t sigma0 = rotateRight(previous, 7) ^ rotateRight(previous, 18) ^ (previous >> 3);
    const std::uint32_t sigma1 = rotateRight(older, 17) ^ rotateRight(older, 19) ^ (older >> 10);
    schedule[static_cast<std::size_t>(index)] =
        schedule[static_cast<std::size_t>(index) - 16] + sigma0 +
        schedule[static_cast<std::size_t>(index) - 7] + sigma1;
  }

  std::uint32_t a = state_[0];
  std::uint32_t b = state_[1];
  std::uint32_t c = state_[2];
  std::uint32_t d = state_[3];
  std::uint32_t e = state_[4];
  std::uint32_t f = state_[5];
  std::uint32_t g = state_[6];
  std::uint32_t h = state_[7];

  for (int index = 0; index < 64; ++index) {
    const std::uint32_t bigSigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
    const std::uint32_t choose = (e & f) ^ (~e & g);
    const std::uint32_t temp1 =
        h + bigSigma1 + choose + kRoundConstants[static_cast<std::size_t>(index)] +
        schedule[static_cast<std::size_t>(index)];
    const std::uint32_t bigSigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
    const std::uint32_t majority = (a & b) ^ (a & c) ^ (b & c);
    const std::uint32_t temp2 = bigSigma0 + majority;

    h = g;
    g = f;
    f = e;
    e = d + temp1;
    d = c;
    c = b;
    b = a;
    a = temp1 + temp2;
  }

  state_[0] += a;
  state_[1] += b;
  state_[2] += c;
  state_[3] += d;
  state_[4] += e;
  state_[5] += f;
  state_[6] += g;
  state_[7] += h;
}

void Sha256::update(std::string_view data) noexcept {
  bits_ += static_cast<std::uint64_t>(data.size()) * 8;
  std::size_t offset = 0;

  if (buffered_ > 0) {
    const std::size_t take = std::min(64 - buffered_, data.size());
    std::memcpy(buffer_.data() + buffered_, data.data(), take);
    buffered_ += take;
    offset += take;
    if (buffered_ == 64) {
      transform(buffer_.data());
      buffered_ = 0;
    }
  }

  while (offset + 64 <= data.size()) {
    transform(reinterpret_cast<const std::uint8_t*>(data.data() + offset));
    offset += 64;
  }

  if (offset < data.size()) {
    buffered_ = data.size() - offset;
    std::memcpy(buffer_.data(), data.data() + offset, buffered_);
  }
}

std::array<std::uint8_t, 32> Sha256::finalise() const noexcept {
  // Padding mutates the buffer, so pad a copy: a caller may hash again.
  Sha256 copy = *this;
  const std::uint64_t bits = copy.bits_;

  copy.buffer_[copy.buffered_++] = 0x80;
  if (copy.buffered_ > 56) {
    while (copy.buffered_ < 64) {
      copy.buffer_[copy.buffered_++] = 0;
    }
    copy.transform(copy.buffer_.data());
    copy.buffered_ = 0;
  }
  while (copy.buffered_ < 56) {
    copy.buffer_[copy.buffered_++] = 0;
  }
  for (int index = 0; index < 8; ++index) {
    copy.buffer_[copy.buffered_++] = static_cast<std::uint8_t>(bits >> (56 - 8 * index));
  }
  copy.transform(copy.buffer_.data());

  std::array<std::uint8_t, 32> digest{};
  for (int index = 0; index < 8; ++index) {
    storeBigEndian32(digest.data() + static_cast<std::size_t>(index) * 4,
                     copy.state_[static_cast<std::size_t>(index)]);
  }
  return digest;
}

std::array<std::uint8_t, 32> Sha256::digest(std::string_view data) noexcept {
  Sha256 hasher;
  hasher.update(data);
  return hasher.finalise();
}

std::string Sha256::hex(std::string_view data) noexcept {
  const std::array<std::uint8_t, 32> bytes = digest(data);
  std::string out;
  out.resize(bytes.size() * 2);
  for (std::size_t index = 0; index < bytes.size(); ++index) {
    out[index * 2] = kHexDigits[(bytes[index] >> 4) & 0x0f];
    out[index * 2 + 1] = kHexDigits[bytes[index] & 0x0f];
  }
  return out;
}

std::string sha256Hex(std::string_view data) noexcept { return Sha256::hex(data); }

} // namespace agri
