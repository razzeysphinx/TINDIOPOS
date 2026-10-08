import { secureStorage } from "../../lib/secure-storage";
import { evaluateOfflineAuthorizationWindow } from "./offline-authorization-policy";

export const OFFLINE_AUTHORIZATION_WINDOW_MS = 12 * 60 * 60 * 1000;
export const OFFLINE_CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60 * 1000;
const OFFLINE_AUTHORIZATION_KEY = "tindio.pos.offline.authorization";

export type OfflineAuthorizationGrant = {
  version: 2;
  organizationId: string;
  profileId: string;
  employeeId: string;
  deviceId: string;
  storeId: string;
  registerId: string;
  shiftId: string;
  issuedAt: string;
  expiresAt: string;
  lastValidatedAt: string;
};
export type OfflineAuthorizationScope = Omit<
  OfflineAuthorizationGrant,
  "version" | "issuedAt" | "expiresAt" | "lastValidatedAt"
>;
export type OfflineAuthorizationFailureReason = "MISSING" | "INVALID" | "EXPIRED" | "CLOCK_ROLLBACK" | "CLOCK_STATE_UNAVAILABLE";
export type OfflineAuthorizationValidation = { ok: true; grant: OfflineAuthorizationGrant } | { ok: false; reason: OfflineAuthorizationFailureReason };

type LegacyOfflineAuthorizationGrant = Omit<OfflineAuthorizationGrant, "version" | "lastValidatedAt"> & { version: 1 };

let authorizationOperationQueue: Promise<void> = Promise.resolve();

function enqueueAuthorizationOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = authorizationOperationQueue.then(operation, operation);
  authorizationOperationQueue = result.then(() => undefined, () => undefined);
  return result;
}

export function saveOfflineAuthorizationGrant(input: OfflineAuthorizationScope) {
  return enqueueAuthorizationOperation(async () => {
    const now = Date.now();
    const issuedAt = new Date(now).toISOString();
    const grant: OfflineAuthorizationGrant = { version: 2, ...input, issuedAt, expiresAt: new Date(now + OFFLINE_AUTHORIZATION_WINDOW_MS).toISOString(), lastValidatedAt: issuedAt };
    await secureStorage.setItem(OFFLINE_AUTHORIZATION_KEY, JSON.stringify(grant));
    return grant;
  });
}

export async function readOfflineAuthorizationGrant(): Promise<OfflineAuthorizationGrant | null> {
  const raw = await secureStorage.getItem(OFFLINE_AUTHORIZATION_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<OfflineAuthorizationGrant | LegacyOfflineAuthorizationGrant>;
    if ((value.version !== 1 && value.version !== 2) || !value.organizationId || !value.profileId || !value.employeeId || !value.deviceId || !value.storeId || !value.registerId || !value.shiftId || !value.issuedAt || !value.expiresAt) return null;
    if (value.version === 1) {
      return { ...value, version: 2, lastValidatedAt: value.issuedAt } as OfflineAuthorizationGrant;
    }
    if (!("lastValidatedAt" in value) || !value.lastValidatedAt) return null;
    return value as OfflineAuthorizationGrant;
  } catch { return null; }
}

async function validateOfflineAuthorizationGrantOnce(now: number): Promise<OfflineAuthorizationValidation> {
  const grant = await readOfflineAuthorizationGrant();
  if (!grant) return { ok: false, reason: "MISSING" };
  const decision = evaluateOfflineAuthorizationWindow(grant, now, OFFLINE_CLOCK_ROLLBACK_TOLERANCE_MS);
  let validatedGrant = grant;
  if (decision.nextLastValidatedAt) {
    validatedGrant = { ...grant, lastValidatedAt: decision.nextLastValidatedAt };
    try {
      await secureStorage.setItem(OFFLINE_AUTHORIZATION_KEY, JSON.stringify(validatedGrant));
    } catch {
      return { ok: false, reason: "CLOCK_STATE_UNAVAILABLE" };
    }
  }
  return decision.ok ? { ok: true, grant: validatedGrant } : { ok: false, reason: decision.reason };
}

export function validateOfflineAuthorizationGrant(now?: number): Promise<OfflineAuthorizationValidation> {
  return enqueueAuthorizationOperation(() => validateOfflineAuthorizationGrantOnce(now ?? Date.now()));
}

export function offlineAuthorizationFailureMessage(reason: string) {
  if (reason === "EXPIRED") return "Offline authorization expired. Connect and sign in to continue. Accepted sales remain saved for recovery.";
  if (reason === "CLOCK_ROLLBACK") return "The device clock moved backward. Connect and sign in to restore offline access. Accepted sales remain saved.";
  if (reason === "CLOCK_STATE_UNAVAILABLE") return "Offline clock verification could not be saved. Connect and sign in; accepted sales remain saved.";
  if (reason === "INVALID") return "Offline authorization is invalid. Connect and prepare this register again. Accepted sales remain saved.";
  return "Offline access is not prepared. Connect and sign in to prepare this register.";
}

export function clearOfflineAuthorizationGrant() {
  return enqueueAuthorizationOperation(() => secureStorage.removeItem(OFFLINE_AUTHORIZATION_KEY));
}
