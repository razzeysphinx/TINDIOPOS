import * as Crypto from "expo-crypto";
import Constants from "expo-constants";
import type { PosDeviceBinding, PosDeviceCredential } from "../../../../../src/contracts/pos";
import { secureStorage } from "../../lib/secure-storage";
export type MobileDeviceIdentity = { organizationId: string; credential: PosDeviceCredential; binding: PosDeviceBinding | null; createdAt: string; lastVerifiedAt: string | null };
const key = (organizationId: string) => `tindio.pos.device.${organizationId}`;
const bytesToHex = (bytes: Uint8Array) => Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
export async function createMobileDeviceCredential(): Promise<PosDeviceCredential> { return { deviceId: Crypto.randomUUID(), secret: bytesToHex(await Crypto.getRandomBytesAsync(32)), appVersion: `android-${Constants.expoConfig?.version ?? "dev"}` }; }
export async function loadMobileDeviceIdentity(organizationId: string) { const raw = await secureStorage.getItem(key(organizationId)); if (!raw) return null; try { const value = JSON.parse(raw) as MobileDeviceIdentity; return value.organizationId === organizationId && value.credential?.deviceId && value.credential?.secret ? value : null; } catch { return null; } }
export async function saveMobileDeviceIdentity(identity: MobileDeviceIdentity) { await secureStorage.setItem(key(identity.organizationId), JSON.stringify(identity)); }
