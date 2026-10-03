import type { PosActiveShift } from "../../../../src/features/pos/pos-types";
import { saveLocalCacheState } from "./cache-state";
import { getTindioDatabase } from "./database";

export async function saveActiveShiftSnapshot(organizationId: string, shift: PosActiveShift | null) {
  const capturedAt = new Date().toISOString();
  const database = await getTindioDatabase();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync("DELETE FROM shift_snapshots WHERE organization_id = ?", organizationId);
    if (shift) await transaction.runAsync("INSERT INTO shift_snapshots (organization_id,store_id,register_id,shift_id,payload_json,captured_at) VALUES (?,?,?,?,?,?)", organizationId, shift.storeId, shift.registerId, shift.id, JSON.stringify(shift), capturedAt);
  });
  await saveLocalCacheState({ organizationId, domain: "shift", storeId: shift?.storeId ?? "", scopeKey: shift?.registerId ?? "none", sourceVersion: null, recordCount: shift ? 1 : 0, isComplete: true, capturedAt });
  return capturedAt;
}

export async function getActiveShiftSnapshot(organizationId: string, storeId: string, registerId: string) {
  const row = await (await getTindioDatabase()).getFirstAsync<{ shift_id: string; payload_json: string; captured_at: string }>(
    "SELECT shift_id,payload_json,captured_at FROM shift_snapshots WHERE organization_id = ? AND store_id = ? AND register_id = ? LIMIT 1",
    organizationId, storeId, registerId,
  );
  if (!row) return null;
  try { return { shift: JSON.parse(row.payload_json) as PosActiveShift, capturedAt: row.captured_at }; } catch { return null; }
}
