/** Stable policy error codes. */
export const POLICY_ERROR_CODES = {
  allowListUnreadable: 'E_POLICY_ALLOW_LIST_UNREADABLE',
  allowListInvalid: 'E_POLICY_ALLOW_LIST_INVALID',
  capabilityDenied: 'E_POLICY_CAPABILITY_DENIED',
  gateNotReached: 'E_POLICY_GATE_NOT_REACHED',
  approvalMissing: 'E_POLICY_APPROVAL_MISSING',
} as const;

export type PolicyErrorCode = (typeof POLICY_ERROR_CODES)[keyof typeof POLICY_ERROR_CODES];

/**
 * Raised when policy data itself is unusable. A policy failure is fail-closed:
 * the caller must refuse to sign or execute, never proceed with a default.
 */
export class PolicyError extends Error {
  readonly code: PolicyErrorCode;
  readonly reasons: readonly string[];

  constructor(code: PolicyErrorCode, message: string, reasons: readonly string[] = []) {
    super(message);
    this.name = 'PolicyError';
    this.code = code;
    this.reasons = Object.freeze([...reasons]);
  }
}
