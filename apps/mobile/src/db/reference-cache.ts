import type {
  PosReferenceV2Response,
} from "../../../../src/contracts/pos";
import {
  saveLocalCacheState,
} from "./cache-state";
import {
  getTindioDatabase,
} from "./database";

export type LocalReferenceSnapshot = {
  organizationId: string;
  referenceVersion: string;
  reference:
    PosReferenceV2Response["reference"];
  capturedAt: string;
};

export async function saveReferenceSnapshot(
  response: PosReferenceV2Response,
) {
  const capturedAt =
    new Date().toISOString();

  const database =
    await getTindioDatabase();

  await database.runAsync(
    "INSERT INTO reference_snapshots (organization_id,reference_version,payload_json,captured_at) VALUES (?,?,?,?) ON CONFLICT(organization_id) DO UPDATE SET reference_version=excluded.reference_version,payload_json=excluded.payload_json,captured_at=excluded.captured_at",
    response.organizationId,
    response.referenceVersion,
    JSON.stringify(
      response.reference,
    ),
    capturedAt,
  );

  await saveLocalCacheState({
    organizationId:
      response.organizationId,
    domain: "reference",
    storeId: "",
    scopeKey: "default",
    sourceVersion:
      response.referenceVersion,
    recordCount: 1,
    isComplete: true,
    capturedAt,
  });

  return capturedAt;
}

export async function getReferenceSnapshot(
  organizationId: string,
): Promise<LocalReferenceSnapshot | null> {
  const row =
    await (
      await getTindioDatabase()
    ).getFirstAsync<{
      reference_version: string;
      payload_json: string;
      captured_at: string;
    }>(
      "SELECT reference_version,payload_json,captured_at FROM reference_snapshots WHERE organization_id = ?",
      organizationId,
    );

  if (!row) {
    return null;
  }

  try {
    const reference =
      JSON.parse(
        row.payload_json,
      ) as PosReferenceV2Response["reference"];

    return {
      organizationId,
      referenceVersion:
        row.reference_version,
      reference,
      capturedAt:
        row.captured_at,
    };
  } catch {
    return null;
  }
}