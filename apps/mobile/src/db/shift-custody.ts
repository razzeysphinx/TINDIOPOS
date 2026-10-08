import { getTindioDatabase } from "./database";

export const SHIFT_FINALIZATION_CUSTODY_SQL = `
  SELECT
    (SELECT count(*) FROM outbox_events
      WHERE organization_id=? AND device_id=? AND store_id=? AND register_id=? AND state<>'SYNCED') AS unresolved_outbox_count,
    (SELECT count(*) FROM outbox_events
      WHERE organization_id=? AND device_id=? AND store_id=? AND register_id=? AND shift_id=? AND state<>'SYNCED') AS shift_outbox_count,
    (SELECT count(*) FROM outbox_events
      WHERE organization_id=? AND device_id=? AND store_id=? AND register_id=? AND state IN ('FAILED','CONFLICT')) AS review_outbox_count,
    (SELECT count(*) FROM checkout_intents
      WHERE organization_id=? AND device_id=? AND store_id=? AND register_id=? AND state IN ('PREPARED','SUBMITTING','UNKNOWN')) AS unresolved_checkout_count,
    (SELECT count(*) FROM checkout_intents
      WHERE organization_id=? AND device_id=? AND store_id=? AND register_id=? AND shift_id=? AND state IN ('PREPARED','SUBMITTING','UNKNOWN')) AS shift_checkout_count,
    coalesce((SELECT next_sequence-1 FROM device_sync_state WHERE organization_id=? AND device_id=?),0) AS local_high_water,
    coalesce((SELECT server_checkpoint FROM device_sync_state WHERE organization_id=? AND device_id=?),0) AS server_checkpoint
`;

export type ShiftFinalizationCustody = {
  unresolvedOutboxCount: number;
  shiftOutboxCount: number;
  reviewOutboxCount: number;
  unresolvedCheckoutCount: number;
  shiftCheckoutCount: number;
  localHighWater: number;
  serverCheckpoint: number;
};

type ShiftFinalizationCustodyRow = {
  unresolved_outbox_count: number;
  shift_outbox_count: number;
  review_outbox_count: number;
  unresolved_checkout_count: number;
  shift_checkout_count: number;
  local_high_water: number;
  server_checkpoint: number;
};

export async function getShiftFinalizationCustody(input: {
  organizationId: string;
  deviceId: string;
  storeId: string;
  registerId: string;
  shiftId: string;
}): Promise<ShiftFinalizationCustody> {
  const scope = [input.organizationId, input.deviceId, input.storeId, input.registerId];
  const row = await (await getTindioDatabase()).getFirstAsync<ShiftFinalizationCustodyRow>(
    SHIFT_FINALIZATION_CUSTODY_SQL,
    ...scope,
    ...scope, input.shiftId,
    ...scope,
    ...scope,
    ...scope, input.shiftId,
    input.organizationId, input.deviceId,
    input.organizationId, input.deviceId,
  );
  if (!row) throw new Error("SHIFT_CUSTODY_UNAVAILABLE");
  return {
    unresolvedOutboxCount: row.unresolved_outbox_count,
    shiftOutboxCount: row.shift_outbox_count,
    reviewOutboxCount: row.review_outbox_count,
    unresolvedCheckoutCount: row.unresolved_checkout_count,
    shiftCheckoutCount: row.shift_checkout_count,
    localHighWater: row.local_high_water,
    serverCheckpoint: row.server_checkpoint,
  };
}
