export type OfflineAuthorizationWindow = {
  issuedAt: string;
  expiresAt: string;
  lastValidatedAt: string;
};

export type OfflineAuthorizationWindowDecision =
  | { ok: true; nextLastValidatedAt: string | null }
  | {
      ok: false;
      reason: "INVALID" | "EXPIRED" | "CLOCK_ROLLBACK";
      nextLastValidatedAt: string | null;
    };

function timestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function evaluateOfflineAuthorizationWindow(
  window: OfflineAuthorizationWindow,
  now: number,
  rollbackToleranceMs: number,
): OfflineAuthorizationWindowDecision {
  const issuedAt = timestamp(window.issuedAt);
  const expiresAt = timestamp(window.expiresAt);
  const lastValidatedAt = timestamp(window.lastValidatedAt);

  if (
    !Number.isFinite(now)
    || !Number.isFinite(rollbackToleranceMs)
    || rollbackToleranceMs < 0
    || issuedAt === null
    || expiresAt === null
    || lastValidatedAt === null
    || expiresAt <= issuedAt
    || lastValidatedAt < issuedAt
  ) {
    return { ok: false, reason: "INVALID", nextLastValidatedAt: null };
  }

  if (now < lastValidatedAt - rollbackToleranceMs) {
    return { ok: false, reason: "CLOCK_ROLLBACK", nextLastValidatedAt: null };
  }

  const nextLastValidatedAt = now > lastValidatedAt
    ? new Date(now).toISOString()
    : null;

  if (now >= expiresAt) {
    return { ok: false, reason: "EXPIRED", nextLastValidatedAt };
  }

  return { ok: true, nextLastValidatedAt };
}
