import type { PosModifierGroup } from "@tindio/contracts";
import { getTindioDatabase } from "./database";

export async function saveModifierSnapshot(
  organizationId: string,
  storeId: string,
  productId: string,
  groups: PosModifierGroup[],
) {
  const capturedAt = new Date().toISOString();
  await (await getTindioDatabase()).runAsync(
    "INSERT INTO modifier_snapshots (organization_id,store_id,product_id,payload_json,captured_at) VALUES (?,?,?,?,?) ON CONFLICT(organization_id,store_id,product_id) DO UPDATE SET payload_json=excluded.payload_json,captured_at=excluded.captured_at",
    organizationId,
    storeId,
    productId,
    JSON.stringify(groups),
    capturedAt,
  );
  return capturedAt;
}

export async function getModifierSnapshot(
  organizationId: string,
  storeId: string,
  productId: string,
) {
  const row = await (await getTindioDatabase()).getFirstAsync<{
    payload_json: string;
    captured_at: string;
  }>(
    "SELECT payload_json,captured_at FROM modifier_snapshots WHERE organization_id=? AND store_id=? AND product_id=?",
    organizationId,
    storeId,
    productId,
  );
  if (!row) return null;
  try {
    return {
      groups: JSON.parse(row.payload_json) as PosModifierGroup[],
      capturedAt: row.captured_at,
    };
  } catch {
    return null;
  }
}

export async function clearModifierSnapshotsForStore(
  organizationId: string,
  storeId: string,
) {
  return (await getTindioDatabase()).runAsync(
    "DELETE FROM modifier_snapshots WHERE organization_id=? AND store_id=?",
    organizationId,
    storeId,
  );
}
