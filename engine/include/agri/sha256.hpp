#pragma once

/**
 * SHA-256 (FIPS 180-4).
 *
 * Implemented here rather than linked from OpenSSL for two reasons: the robot
 * image should not acquire a crypto dependency to hash a journal, and the digest
 * is part of the equivalence contract with the TypeScript engine — a version of
 * it that this repository pins cannot change underneath a signed artifact.
 */

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>

namespace agri {

class Sha256 {
public:
  Sha256() noexcept { reset(); }

  void reset() noexcept;
  void update(std::string_view data) noexcept;

  /** Digest of everything fed so far. Does not disturb the running state. */
  [[nodiscard]] std::array<std::uint8_t, 32> finalise() const noexcept;

  [[nodiscard]] static std::array<std::uint8_t, 32> digest(std::string_view data) noexcept;
  [[nodiscard]] static std::string hex(std::string_view data) noexcept;

private:
  void transform(const std::uint8_t* block) noexcept;

  std::array<std::uint32_t, 8> state_{};
  std::uint64_t bits_ = 0;
  std::array<std::uint8_t, 64> buffer_{};
  std::size_t buffered_ = 0;
};

/** Lowercase hex digest, the form every hash in this repository is written in. */
[[nodiscard]] std::string sha256Hex(std::string_view data) noexcept;

} // namespace agri
