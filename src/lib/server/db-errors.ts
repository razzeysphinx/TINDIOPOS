import "server-only";

// Shared Postgres/database-error-to-user-message mechanism.
//
// Feature-specific wording intentionally stays with each feature: these
// helpers only centralize the lookup mechanics and the byte-identical
// messages that are duplicated across features. Message-passthrough
// mappers (devices, shifts, approvals, tickets, payments) keep their own
// local implementations because their semantics differ deliberately.

export const PERMISSION_DENIED_MESSAGE = "You do not have permission to make this change.";

export const VALIDATION_INVALID_MESSAGE = "Check the highlighted details and try again.";

export function validationFailure() {
  return { ok: false as const, message: VALIDATION_INVALID_MESSAGE };
}

export function postgresCodeMessage(
  code: string | null | undefined,
  fallback: string,
  codeMessages: Record<string, string>,
) {
  if (code != null && Object.hasOwn(codeMessages, code)) {
    return codeMessages[code];
  }

  return fallback;
}
