import { secureStorage } from "../../lib/secure-storage";

export const OFFLINE_AUTHORIZATION_WINDOW_MS = 12 * 60 * 60 * 1000;
export const OFFLINE_CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60 * 1000;
const OFFLINE_AUTHORIZATION_KEY = "tindio.pos.offline.authorization";

export type OfflineAuthorizationGrant = {
  version: 1;
  organizationId: string;
  profileId: string;
  employeeId: string;
  deviceId: string;
  storeId: string;
  registerId: string;
  shiftId: string;
  issuedAt: string;
  expiresAt: string;
};
export type OfflineAuthorizationValidation = { ok: true; grant: OfflineAuthorizationGrant } | { ok: false; reason: "MISSING" | "INVALID" | "EXPIRED" | "CLOCK_ROLLBACK" };

function parseTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export async function saveOfflineAuthorizationGrant(input: Omit<OfflineAuthorizationGrant, "version" | "issuedAt" | "expiresAt">) {
  const now = Date.now();
  const grant: OfflineAuthorizationGrant = { version: 1, ...input, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + OFFLINE_AUTHORIZATION_WINDOW_MS).toISOString() };
  await secureStorage.setItem(OFFLINE_AUTHORIZATION_KEY, JSON.stringify(grant));
  return grant;
}

export async function readOfflineAuthorizationGrant(): Promise<OfflineAuthorizationGrant | null> {
  const raw = await secureStorage.getItem(OFFLINE_AUTHORIZATION_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<OfflineAuthorizationGrant>;
    if (value.version !== 1 || !value.organizationId || !value.profileId || !value.employeeId || !value.deviceId || !value.storeId || !value.registerId || !value.shiftId || !value.issuedAt || !value.expiresAt) return null;
    return value as OfflineAuthorizationGrant;
  } catch { return null; }
}

export async function validateOfflineAuthorizationGrant(now = Date.now()): Promise<OfflineAuthorizationValidation> {
  const grant = await readOfflineAuthorizationGrant();
  if (!grant) return { ok: false, reason: "MISSING" };
  const issuedAt = parseTimestamp(grant.issuedAt);
  const expiresAt = parseTimestamp(grant.expiresAt);
  if (issuedAt === null || expiresAt === null || expiresAt <= issuedAt) return { ok: false, reason: "INVALID" };
  if (now < issuedAt - OFFLINE_CLOCK_ROLLBACK_TOLERANCE_MS) return { ok: false, reason: "CLOCK_ROLLBACK" };
  if (now > expiresAt) return { ok: false, reason: "EXPIRED" };
  return { ok: true, grant };
}

export async function clearOfflineAuthorizationGrant() { await secureStorage.removeItem(OFFLINE_AUTHORIZATION_KEY); }
