import { createError } from 'h3';

/**
 * The compiler and the policy package raise typed errors with structured
 * reasons. The lab shows them verbatim: an engineer reading a refusal must see
 * the code the toolchain would print, not a paraphrase.
 */
export interface LabIssue {
  code: string;
  message: string;
  statementId?: string | null;
  severity?: string;
}

export interface LabErrorBody {
  code: string;
  message: string;
  issues: LabIssue[];
}

export function toLabError(error: unknown): LabErrorBody {
  const candidate = error as {
    name?: string;
    message?: string;
    code?: string;
    issues?: ReadonlyArray<Record<string, unknown>>;
    reasons?: readonly string[];
    details?: readonly string[];
  };

  if (Array.isArray(candidate?.issues)) {
    return {
      code: 'E_TASK_INVALID',
      message: candidate.message ?? 'the task did not compile',
      issues: candidate.issues.map((issue) => ({
        code: String(issue['code'] ?? 'E_UNKNOWN'),
        message: String(issue['message'] ?? ''),
        statementId: issue['statementId'] === undefined ? null : String(issue['statementId']),
        severity: issue['level'] === undefined ? 'error' : String(issue['level']),
      })),
    };
  }

  const reasons = [...(candidate?.reasons ?? []), ...(candidate?.details ?? [])];
  return {
    code: typeof candidate?.code === 'string' ? candidate.code : 'E_LAB_INTERNAL',
    message: candidate?.message ?? String(error),
    issues: reasons.map((reason) => ({ code: 'E_POLICY', message: reason, statementId: null })),
  };
}

export function labError(statusCode: number, error: unknown) {
  const body = toLabError(error);
  return createError({ statusCode, statusMessage: body.code, message: body.message, data: body });
}
