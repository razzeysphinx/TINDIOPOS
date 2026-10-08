export const OFFLINE_EXPIRY_WARNING_MS = 60 * 60 * 1000;
export const OFFLINE_AUTHORIZATION_MONITOR_INTERVAL_MS = 60 * 1000;

export type OfflineAuthorizationLifecycleState =
  | "READY"
  | "EXPIRING_SOON"
  | "EXPIRED_RECONNECT_REQUIRED"
  | "PREPARATION_REQUIRED";

export type CashierReadinessState =
  | "READY_OFFLINE"
  | "EXPIRING_SOON"
  | "EXPIRED_RECONNECT_REQUIRED"
  | "PREPARATION_REQUIRED"
  | "RECOVERING"
  | "SYNC_REVIEW";

export function evaluateOfflineAuthorizationLifecycle(input: {
  prepared: boolean;
  expiresAt: string | null;
  restrictionReason: string | null;
  now: number;
}): OfflineAuthorizationLifecycleState {
  if (input.restrictionReason) {
    return input.restrictionReason === "MISSING"
      ? "PREPARATION_REQUIRED"
      : "EXPIRED_RECONNECT_REQUIRED";
  }
  if (!input.prepared || !input.expiresAt) return "PREPARATION_REQUIRED";

  const expiresAt = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiresAt)) return "PREPARATION_REQUIRED";
  if (input.now >= expiresAt) return "EXPIRED_RECONNECT_REQUIRED";
  if (expiresAt - input.now <= OFFLINE_EXPIRY_WARNING_MS) return "EXPIRING_SOON";
  return "READY";
}

export function nextOfflineAuthorizationCheckDelay(input: {
  state: OfflineAuthorizationLifecycleState;
  expiresAt: string | null;
  now: number;
}) {
  if (!input.expiresAt || input.state === "EXPIRED_RECONNECT_REQUIRED" || input.state === "PREPARATION_REQUIRED") {
    return null;
  }
  const expiresAt = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiresAt)) return null;
  const nextBoundary = input.state === "READY"
    ? expiresAt - OFFLINE_EXPIRY_WARNING_MS
    : expiresAt;
  return Math.max(1, Math.min(
    OFFLINE_AUTHORIZATION_MONITOR_INTERVAL_MS,
    nextBoundary - input.now,
  ));
}

export function deriveCashierReadinessState(input: {
  connectionMode: string;
  authorizationState: OfflineAuthorizationLifecycleState;
}): CashierReadinessState {
  if (input.connectionMode === "RECOVERING") return "RECOVERING";
  if (input.connectionMode === "SYNC_REVIEW") return "SYNC_REVIEW";
  if (input.authorizationState === "READY") return "READY_OFFLINE";
  return input.authorizationState;
}

export function cashierReadinessLabel(state: CashierReadinessState) {
  if (state === "READY_OFFLINE") return "READY OFFLINE";
  if (state === "EXPIRING_SOON") return "EXPIRING SOON";
  if (state === "EXPIRED_RECONNECT_REQUIRED") return "EXPIRED / RECONNECT REQUIRED";
  if (state === "PREPARATION_REQUIRED") return "PREPARATION REQUIRED";
  if (state === "RECOVERING") return "RECOVERING";
  return "SYNC REVIEW";
}

export function canAcceptOfflineSale(state: CashierReadinessState) {
  return state === "READY_OFFLINE" || state === "EXPIRING_SOON";
}
