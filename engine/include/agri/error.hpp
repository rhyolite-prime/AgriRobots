#pragma once

/**
 * Errors the engine raises on its own behalf.
 *
 * Codes deliberately mirror the TypeScript reference engine, so a refusal reads
 * the same whichever implementation produced it: `E_NON_DETERMINISTIC` is the
 * code `packages/compiler-core/src/lang/ir.ts` uses when a value cannot be
 * canonicalised reproducibly.
 */

#include <stdexcept>
#include <string>
#include <string_view>

namespace agri {

class AgriEngineError : public std::runtime_error {
public:
  AgriEngineError(std::string_view code, std::string_view message)
      : std::runtime_error(std::string(message)), code_(code) {}

  [[nodiscard]] const std::string& code() const noexcept { return code_; }

private:
  std::string code_;
};

} // namespace agri
