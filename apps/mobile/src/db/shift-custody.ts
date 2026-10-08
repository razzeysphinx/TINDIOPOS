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

export type ShiftFinalizationGuard = {
  organizationId: string;
  shiftId: string;
  deviceId: string;
  storeId: string;
  registerId: string;
  finalizationToken: string;
  localHighWater: number;
  state: "FINALIZING" | "CLOSED";
};

type ShiftFinalizationGuardRow = {
  organization_id: string;
  shift_id: string;
  device_id: string;
  store_id: string;
  register_id: string;
  finalization_token: string;
  local_high_water: number;
  state: ShiftFinalizationGuard["state"];
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

function toGuard(row: ShiftFinalizationGuardRow): ShiftFinalizationGuard {
  return {
    organizationId: row.organization_id,
    shiftId: row.shift_id,
    deviceId: row.device_id,
    storeId: row.store_id,
    registerId: row.register_id,
    finalizationToken: row.finalization_token,
    localHighWater: row.local_high_water,
    state: row.state,
  };
}

export async function beginShiftFinalizationGuard(input: {
  organizationId: string;
  deviceId: string;
  storeId: string;
  registerId: string;
  shiftId: string;
  finalizationToken: string;
}): Promise<ShiftFinalizationGuard> {
  const database = await getTindioDatabase();
  let resolved: ShiftFinalizationGuard | null = null;

  await database.withExclusiveTransactionAsync(async (transaction) => {
    const existing = await transaction.getFirstAsync<ShiftFinalizationGuardRow>(
      "SELECT * FROM shift_finalization_guards WHERE organization_id=? AND shift_id=?",
      input.organizationId,
      input.shiftId,
    );
    if (existing?.state === "FINALIZING") {
      if (
        existing.device_id !== input.deviceId
        || existing.store_id !== input.storeId
        || existing.register_id !== input.registerId
      ) throw new Error("SHIFT_FINALIZATION_SCOPE_CONFLICT");
      resolved = toGuard(existing);
      return;
    }
    if (existing?.state === "CLOSED") throw new Error("SHIFT_ALREADY_FINALIZED");

    const scope = [input.organizationId, input.deviceId, input.storeId, input.registerId];
    const custody = await transaction.getFirstAsync<ShiftFinalizationCustodyRow>(
      SHIFT_FINALIZATION_CUSTODY_SQL,
      ...scope,
      ...scope, input.shiftId,
      ...scope,
      ...scope,
      ...scope, input.shiftId,
      input.organizationId, input.deviceId,
      input.organizationId, input.deviceId,
    );
    if (!custody) throw new Error("SHIFT_CUSTODY_UNAVAILABLE");
    if (
      custody.unresolved_outbox_count !== 0
      || custody.shift_outbox_count !== 0
      || custody.review_outbox_count !== 0
      || custody.unresolved_checkout_count !== 0
      || custody.shift_checkout_count !== 0
    ) throw new Error("SHIFT_HAS_UNRESOLVED_MONEY");
    if (custody.local_high_water !== custody.server_checkpoint) {
      throw new Error("SHIFT_CHECKPOINT_NOT_RECONCILED");
    }

    const now = new Date().toISOString();
    await transaction.runAsync(
      `INSERT INTO shift_finalization_guards
        (organization_id,shift_id,device_id,store_id,register_id,finalization_token,local_high_water,state,started_at,updated_at,last_error)
       VALUES (?,?,?,?,?,?,?,'FINALIZING',?,?,NULL)`,
      input.organizationId, input.shiftId, input.deviceId, input.storeId, input.registerId,
      input.finalizationToken, custody.local_high_water, now, now,
    );
    const row = await transaction.getFirstAsync<ShiftFinalizationGuardRow>(
      "SELECT * FROM shift_finalization_guards WHERE organization_id=? AND shift_id=?",
      input.organizationId,
      input.shiftId,
    );
    if (!row || row.state !== "FINALIZING") throw new Error("SHIFT_FINALIZATION_GUARD_NOT_DURABLE");
    resolved = toGuard(row);
  });

  if (!resolved) throw new Error("SHIFT_FINALIZATION_GUARD_NOT_DURABLE");
  return resolved;
}

export async function completeShiftFinalizationGuard(
  organizationId: string,
  shiftId: string,
  finalizationToken: string,
) {
  const result = await (await getTindioDatabase()).runAsync(
    `UPDATE shift_finalization_guards SET state='CLOSED',updated_at=?,last_error=NULL
     WHERE organization_id=? AND shift_id=? AND finalization_token=? AND state='FINALIZING'`,
    new Date().toISOString(), organizationId, shiftId, finalizationToken,
  );
  if (result.changes !== 1) throw new Error("SHIFT_FINALIZATION_COMPLETION_NOT_DURABLE");
}

export async function isShiftFinalizationInProgress(
  organizationId: string,
  shiftId: string,
) {
  const row = await (await getTindioDatabase()).getFirstAsync<{ shift_id: string }>(
    "SELECT shift_id FROM shift_finalization_guards WHERE organization_id=? AND shift_id=? AND state='FINALIZING'",
    organizationId,
    shiftId,
  );
  return Boolean(row);
}
