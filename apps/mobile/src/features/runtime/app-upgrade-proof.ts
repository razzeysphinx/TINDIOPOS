import * as Application from "expo-application";
import * as Crypto from "expo-crypto";

import {
  getLocalSchemaVersion,
  getTindioDatabase,
  readLocalMetadata,
  writeLocalMetadata,
} from "../../db/database";
import { secureStorage } from "../../lib/secure-storage";
import { SUPABASE_MOBILE_AUTH_STORAGE_KEY } from "../../lib/supabase";
import { loadMobileDeviceIdentity } from "../device/device-store";
import { readOfflineAuthorizationGrant } from "../offline/offline-authorization";
import { mobileAuth } from "../session/auth-provider";
import { NEON_MOBILE_AUTH_COOKIE_KEY } from "../session/auth-storage-keys";
import { inspectMobileAuthTransition } from "../session/auth-transition";

type EventRow = {
  event_id: string;
  device_id: string;
  idempotency_key: string;
  device_sequence: number;
  payload_json: string;
  snapshot_json: string;
};

type ReceiptRow = { snapshot_json: string };
type DeviceSequenceRow = {
  device_id: string;
  next_sequence: number;
  server_checkpoint: number;
};

type ProofEvent = {
  eventId: string;
  deviceId: string;
  idempotencyKey: string;
  deviceSequence: number;
  contentDigest: string;
  receiptContentDigest: string | null;
};

type DeviceSequenceProof = {
  deviceId: string;
  nextSequence: number;
  serverCheckpoint: number;
};

type DeviceEnrollmentProof = {
  organizationId: string;
  deviceId: string;
  storeId: string | null;
  registerId: string | null;
};

type OfflineAuthorizationProof = {
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

export type AppUpgradeProof = {
  version: 2;
  organizationId: string;
  armedAt: string;
  applicationVersion: string | null;
  nativeBuildVersion: string | null;
  schemaVersion: number;
  auth: {
    targetProvider: "supabase" | "neon";
    state: string;
    legacySupabaseSessionPresent: boolean;
    neonSessionPresent: boolean;
  };
  deviceEnrollment: DeviceEnrollmentProof | null;
  offlineAuthorization: OfflineAuthorizationProof | null;
  deviceSequences: DeviceSequenceProof[];
  events: ProofEvent[];
};

type FailureReason =
  | "NOT_ARMED"
  | "EVENT_MISSING"
  | "EVENT_IDENTITY_CHANGED"
  | "EVENT_CONTENT_CHANGED"
  | "RECEIPT_MISSING"
  | "RECEIPT_CONTENT_CHANGED"
  | "AUTH_SESSION_MISSING"
  | "DEVICE_ENROLLMENT_MISSING"
  | "DEVICE_ENROLLMENT_CHANGED"
  | "OFFLINE_AUTHORIZATION_MISSING"
  | "OFFLINE_AUTHORIZATION_CHANGED"
  | "SEQUENCE_CHECKPOINT_MISSING"
  | "SEQUENCE_CHECKPOINT_CHANGED"
  | "INVALID_PROOF";

export type AppUpgradeVerification =
  | {
      ok: true;
      proof: AppUpgradeProof;
      currentApplicationVersion: string | null;
      currentNativeBuildVersion: string | null;
      currentSchemaVersion: number;
      currentAuthState: string;
    }
  | { ok: false; reason: FailureReason; eventId?: string };

const key = (organizationId: string) => `phase23_upgrade_proof:${organizationId}`;

async function digest(value: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
}

async function digestEvent(row: EventRow) {
  return digest([row.payload_json, row.snapshot_json].join("\n"));
}

async function authSnapshot() {
  return inspectMobileAuthTransition({
    neonStorageKey: NEON_MOBILE_AUTH_COOKIE_KEY,
    storage: secureStorage,
    supabaseStorageKey: SUPABASE_MOBILE_AUTH_STORAGE_KEY,
    targetProvider: mobileAuth.provider,
  });
}

function enrollmentSnapshot(
  identity: Awaited<ReturnType<typeof loadMobileDeviceIdentity>>,
): DeviceEnrollmentProof | null {
  return identity
    ? {
        organizationId: identity.organizationId,
        deviceId: identity.credential.deviceId,
        storeId: identity.binding?.storeId ?? null,
        registerId: identity.binding?.registerId ?? null,
      }
    : null;
}

function authorizationSnapshot(
  grant: Awaited<ReturnType<typeof readOfflineAuthorizationGrant>>,
): OfflineAuthorizationProof | null {
  return grant
    ? {
        organizationId: grant.organizationId,
        profileId: grant.profileId,
        employeeId: grant.employeeId,
        deviceId: grant.deviceId,
        storeId: grant.storeId,
        registerId: grant.registerId,
        shiftId: grant.shiftId,
        issuedAt: grant.issuedAt,
        expiresAt: grant.expiresAt,
      }
    : null;
}

export async function armAppUpgradeProof(
  organizationId: string,
): Promise<AppUpgradeProof> {
  const database = await getTindioDatabase();
  const rows = await database.getAllAsync<EventRow>(
    `SELECT event_id,device_id,idempotency_key,device_sequence,payload_json,snapshot_json
     FROM outbox_events
     WHERE organization_id=? AND state<>'SYNCED'
     ORDER BY device_sequence ASC,event_id ASC`,
    organizationId,
  );
  const events: ProofEvent[] = [];
  for (const row of rows) {
    const receipt = await database.getFirstAsync<ReceiptRow>(
      "SELECT snapshot_json FROM local_receipts WHERE organization_id=? AND event_id=? LIMIT 1",
      organizationId,
      row.event_id,
    );
    events.push({
      eventId: row.event_id,
      deviceId: row.device_id,
      idempotencyKey: row.idempotency_key,
      deviceSequence: row.device_sequence,
      contentDigest: await digestEvent(row),
      receiptContentDigest: receipt ? await digest(receipt.snapshot_json) : null,
    });
  }
  const sequenceRows = await database.getAllAsync<DeviceSequenceRow>(
    `SELECT device_id,next_sequence,server_checkpoint FROM device_sync_state
     WHERE organization_id=? ORDER BY device_id ASC`,
    organizationId,
  );
  const [auth, identity, grant] = await Promise.all([
    authSnapshot(),
    loadMobileDeviceIdentity(organizationId),
    readOfflineAuthorizationGrant(),
  ]);
  const proof: AppUpgradeProof = {
    version: 2,
    organizationId,
    armedAt: new Date().toISOString(),
    applicationVersion: Application.nativeApplicationVersion,
    nativeBuildVersion: Application.nativeBuildVersion,
    schemaVersion: await getLocalSchemaVersion(),
    auth: {
      targetProvider: auth.targetProvider,
      state: auth.state,
      legacySupabaseSessionPresent: auth.legacySupabaseSessionPresent,
      neonSessionPresent: auth.neonSessionPresent,
    },
    deviceEnrollment: enrollmentSnapshot(identity),
    offlineAuthorization: authorizationSnapshot(grant),
    deviceSequences: sequenceRows.map((row) => ({
      deviceId: row.device_id,
      nextSequence: row.next_sequence,
      serverCheckpoint: row.server_checkpoint,
    })),
    events,
  };
  await writeLocalMetadata(key(organizationId), JSON.stringify(proof));
  return proof;
}

export async function verifyAppUpgradeProof(
  organizationId: string,
): Promise<AppUpgradeVerification> {
  const saved = await readLocalMetadata(key(organizationId));
  if (!saved) return { ok: false, reason: "NOT_ARMED" };
  let proof: AppUpgradeProof;
  try {
    proof = JSON.parse(saved.value) as AppUpgradeProof;
  } catch {
    return { ok: false, reason: "INVALID_PROOF" };
  }
  if (
    proof.version !== 2
    || proof.organizationId !== organizationId
    || !proof.auth
    || !Array.isArray(proof.events)
    || !Array.isArray(proof.deviceSequences)
  ) return { ok: false, reason: "INVALID_PROOF" };

  const database = await getTindioDatabase();
  const [currentAuth, identity, grant] = await Promise.all([
    authSnapshot(),
    loadMobileDeviceIdentity(organizationId),
    readOfflineAuthorizationGrant(),
  ]);
  if (
    (proof.auth.legacySupabaseSessionPresent && !currentAuth.legacySupabaseSessionPresent)
    || (proof.auth.neonSessionPresent && !currentAuth.neonSessionPresent)
  ) return { ok: false, reason: "AUTH_SESSION_MISSING" };

  const currentEnrollment = enrollmentSnapshot(identity);
  if (proof.deviceEnrollment && !currentEnrollment) {
    return { ok: false, reason: "DEVICE_ENROLLMENT_MISSING" };
  }
  if (
    proof.deviceEnrollment
    && JSON.stringify(proof.deviceEnrollment) !== JSON.stringify(currentEnrollment)
  ) return { ok: false, reason: "DEVICE_ENROLLMENT_CHANGED" };

  const currentAuthorization = authorizationSnapshot(grant);
  if (proof.offlineAuthorization && !currentAuthorization) {
    return { ok: false, reason: "OFFLINE_AUTHORIZATION_MISSING" };
  }
  if (
    proof.offlineAuthorization
    && JSON.stringify(proof.offlineAuthorization) !== JSON.stringify(currentAuthorization)
  ) return { ok: false, reason: "OFFLINE_AUTHORIZATION_CHANGED" };

  for (const expected of proof.deviceSequences) {
    const current = await database.getFirstAsync<DeviceSequenceRow>(
      `SELECT device_id,next_sequence,server_checkpoint FROM device_sync_state
       WHERE organization_id=? AND device_id=? LIMIT 1`,
      organizationId,
      expected.deviceId,
    );
    if (!current) return { ok: false, reason: "SEQUENCE_CHECKPOINT_MISSING" };
    if (
      current.next_sequence !== expected.nextSequence
      || current.server_checkpoint !== expected.serverCheckpoint
    ) return { ok: false, reason: "SEQUENCE_CHECKPOINT_CHANGED" };
  }

  for (const expected of proof.events) {
    const row = await database.getFirstAsync<EventRow>(
      `SELECT event_id,device_id,idempotency_key,device_sequence,payload_json,snapshot_json
       FROM outbox_events WHERE organization_id=? AND event_id=? LIMIT 1`,
      organizationId,
      expected.eventId,
    );
    if (!row) return { ok: false, reason: "EVENT_MISSING", eventId: expected.eventId };
    if (
      row.idempotency_key !== expected.idempotencyKey
      || row.device_id !== expected.deviceId
      || row.device_sequence !== expected.deviceSequence
    ) return { ok: false, reason: "EVENT_IDENTITY_CHANGED", eventId: expected.eventId };
    if (await digestEvent(row) !== expected.contentDigest) {
      return { ok: false, reason: "EVENT_CONTENT_CHANGED", eventId: expected.eventId };
    }
    if (expected.receiptContentDigest) {
      const receipt = await database.getFirstAsync<ReceiptRow>(
        "SELECT snapshot_json FROM local_receipts WHERE organization_id=? AND event_id=? LIMIT 1",
        organizationId,
        expected.eventId,
      );
      if (!receipt) return { ok: false, reason: "RECEIPT_MISSING", eventId: expected.eventId };
      if (await digest(receipt.snapshot_json) !== expected.receiptContentDigest) {
        return { ok: false, reason: "RECEIPT_CONTENT_CHANGED", eventId: expected.eventId };
      }
    }
  }

  return {
    ok: true,
    proof,
    currentApplicationVersion: Application.nativeApplicationVersion,
    currentNativeBuildVersion: Application.nativeBuildVersion,
    currentSchemaVersion: await getLocalSchemaVersion(),
    currentAuthState: currentAuth.state,
  };
}
