/** Stable error codes so CI, the Virtual Lab and the edge runtime report identically. */
export const ERROR_CODES = {
  yamlParse: 'E_YAML_PARSE',
  duplicateKey: 'E_YAML_DUPLICATE_KEY',
  mergeKey: 'E_YAML_MERGE_KEY',
  schemaInvalid: 'E_SCHEMA_INVALID',
  schemaUnreadable: 'E_SCHEMA_UNREADABLE',
  repoLayout: 'E_REPO_LAYOUT',
  semantic: 'E_SEMANTIC',
  policy: 'E_POLICY',
  notImplemented: 'E_NOT_IMPLEMENTED',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Base error for every AgriScript failure. A recipe that fails must never be
 * partially executable: the compiler raises, the caller records the reason and
 * no artifact is signed.
 */
export class AgriScriptError extends Error {
  readonly code: ErrorCode;
  readonly details: readonly string[];

  constructor(code: ErrorCode, message: string, details: readonly string[] = []) {
    super(message);
    this.name = 'AgriScriptError';
    this.code = code;
    this.details = Object.freeze([...details]);
  }
}

/** Raised by pipeline stages that are specified but not yet implemented. */
export class NotImplementedError extends AgriScriptError {
  constructor(stage: string, planReference: string) {
    super(
      ERROR_CODES.notImplemented,
      `${stage} is specified but not implemented yet. See ${planReference}.`,
    );
    this.name = 'NotImplementedError';
  }
}
