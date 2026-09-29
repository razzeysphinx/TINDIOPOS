import type { PosActiveShift } from "../../../../src/features/pos/pos-types";
import { saveLocalCacheState } from "./cache-state";
import { getTindioDatabase } from "./database";

export async function saveActiveShiftSnapshot(organizationId: string, shift: PosActiveShift | null) {
  if (!shift) return null;
  const capturedAt = new Date().toISOString();
  await (await getTindioDatabase()).runAsync(
    "INSERT INTO shift_snapshots (organization_id,store_id,register_id,shift_id,payload_json,captured_at) VALUES (?,?,?,?,?,?) ON CONFLICT(organization_id,store_id,register_id) DO UPDATE SET shift_id=excluded.shift_id,payload_json=excluded.payload_json,captured_at=excluded.captured_at",
    organizationId,
    shift.storeId,
    shift.registerId,
    shift.id,
    JSON.stringify(shift),
    capturedAt,
  );
  await saveLocalCacheState({ organizationId, domain: "shift", storeId: shift.storeId, scopeKey: shift.registerId, sourceVersion: null, recordCount: 1, isComplete: true, capturedAt });
  return capturedAt;
}
