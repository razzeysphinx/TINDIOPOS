import * as Crypto from "expo-crypto";
import { closeTindioDatabase, getLocalSchemaVersion, getTindioDatabase, readLocalMetadata, writeLocalMetadata } from "./database";
import { TINDIO_LOCAL_SCHEMA_VERSION } from "./schema";

export async function getLocalDatabaseHealth() {
  try {
    const database = await getTindioDatabase();
    const journal = await database.getFirstAsync<{ journal_mode: string }>("PRAGMA journal_mode");
    const quickCheck = await database.getFirstAsync<{ quick_check: string }>("PRAGMA quick_check");
    const schemaVersion = await getLocalSchemaVersion();
    const integrity = quickCheck?.quick_check === "ok" ? "ok" : "check-required";
    const verified = await readLocalMetadata("persistence_verified_at");
    return { ready: schemaVersion === TINDIO_LOCAL_SCHEMA_VERSION && integrity === "ok", schemaVersion, expectedSchemaVersion: TINDIO_LOCAL_SCHEMA_VERSION, journalMode: journal?.journal_mode ?? null, integrity, persistenceVerifiedAt: verified?.value ?? null, error: null };
  } catch {
    return { ready: false, schemaVersion: 0, expectedSchemaVersion: TINDIO_LOCAL_SCHEMA_VERSION, journalMode: null, integrity: "check-required", persistenceVerifiedAt: null, error: "SQLite unavailable" };
  }
}

export async function verifyLocalPersistence() {
  const marker = Crypto.randomUUID();
  await writeLocalMetadata("persistence_probe", marker);
  await closeTindioDatabase();
  const persisted = await readLocalMetadata("persistence_probe");
  if (persisted?.value !== marker) throw new Error("SQLite persistence verification failed.");
  const timestamp = new Date().toISOString();
  await writeLocalMetadata("persistence_verified_at", timestamp);
  return timestamp;
}

export type Phase07RestartProof = { organizationId: string; marker: string; armedAt: string };

export async function armPhase07RestartProof(organizationId: string): Promise<Phase07RestartProof> {
  const value = JSON.stringify({ organizationId, marker: Crypto.randomUUID(), armedAt: new Date().toISOString() });
  await writeLocalMetadata("phase_07_restart_proof", value);
  return JSON.parse(value) as Phase07RestartProof;
}

export async function readPhase07RestartProof(): Promise<Phase07RestartProof | null> {
  const row = await readLocalMetadata("phase_07_restart_proof");
  if (!row) return null;
  try { return JSON.parse(row.value) as Phase07RestartProof; } catch { return null; }
}
