import { getTindioDatabase } from "./database";
import { ensureDeviceSyncState } from "./device-sync-state";
import type {
  DurableOutboxEvent,
  NewDurableOutboxEvent,
  OutboxRecoveryItem,
  OutboxState,
  OutboxSummary,
  SafeOutboxEventSummary,
} from "../features/outbox/outbox-types";

type OutboxRow = {
  event_id: string;
  organization_id: string;
  store_id: string;
  register_id: string;
  device_id: string;
  device_sequence: number;
  shift_id: string;
  operation_type: "SALE_COMPLETED";
  idempotency_key: string;
  local_reference: string;
  payload_json: string;
  snapshot_json: string;
  state: OutboxState;
  attempts: number;
  created_at: string;
  updated_at: string;
  last_attempt_at: string | null;
  next_retry_at: string | null;
  synced_at: string | null;
  last_error: string | null;
  conflict_type: string | null;
  server_sale_id: string | null;
  official_receipt_number: number | null;
};

export const OUTBOX_RECOVERY_UPDATE_SQL = `UPDATE outbox_events SET state='LOCAL_PENDING',next_retry_at=NULL,last_error=?,conflict_type=NULL,updated_at=? WHERE organization_id=? AND device_id=? AND event_id=? AND state=?`;
export const OUTBOX_RECOVERY_AUDIT_SQL = `INSERT INTO outbox_recovery_actions (organization_id,event_id,device_id,actor_profile_id,actor_employee_id,prior_state,prior_error,prior_conflict_type,action,reason,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`;
export const LOCAL_RECEIPT_INSERT_SQL = `INSERT INTO local_receipts (event_id,organization_id,store_id,register_id,local_reference,snapshot_version,snapshot_json,created_at) VALUES (?,?,?,?,?,?,?,?)`;
export const OFFICIAL_RECEIPT_LINK_SQL = `UPDATE local_receipts SET server_sale_id=?,official_receipt_number=?,linked_at=? WHERE organization_id=? AND event_id=? AND server_sale_id IS NULL AND official_receipt_number IS NULL AND linked_at IS NULL`;
export const OUTBOX_SYNC_ACK_SQL = `UPDATE outbox_events SET state='SYNCED',last_error=NULL,conflict_type=NULL,next_retry_at=NULL,synced_at=?,server_sale_id=?,official_receipt_number=?,updated_at=? WHERE organization_id=? AND event_id=?`;

function toEvent(row: OutboxRow): DurableOutboxEvent | null {
  try {
    if (!Number.isSafeInteger(row.device_sequence) || row.device_sequence < 1) return null;
    const payload = JSON.parse(row.payload_json) as DurableOutboxEvent["payload"];
    if (!payload.offline) return null;
    payload.offline.deviceSequence = row.device_sequence;
    return {
      eventId: row.event_id, organizationId: row.organization_id, storeId: row.store_id,
      registerId: row.register_id, deviceId: row.device_id, deviceSequence: row.device_sequence, shiftId: row.shift_id,
      operationType: row.operation_type, idempotencyKey: row.idempotency_key,
      localReference: row.local_reference, payload,
      snapshot: JSON.parse(row.snapshot_json), state: row.state, attempts: row.attempts,
      createdAt: row.created_at, updatedAt: row.updated_at, lastAttemptAt: row.last_attempt_at,
      nextRetryAt: row.next_retry_at, syncedAt: row.synced_at, lastError: row.last_error,
      conflictType: row.conflict_type, serverSaleId: row.server_sale_id,
      officialReceiptNumber: row.official_receipt_number,
    };
  } catch {
    return null;
  }
}

export async function enqueueSaleCompletedEvent(
  input: NewDurableOutboxEvent,
): Promise<DurableOutboxEvent | null> {
  const database =
    await getTindioDatabase();

  let resolved:
    DurableOutboxEvent | null = null;

  await database.withExclusiveTransactionAsync(
    async (transaction) => {
      const existing =
        await transaction.getFirstAsync<OutboxRow>(
          "SELECT * FROM outbox_events WHERE organization_id = ? AND idempotency_key = ?",
          input.organizationId,
          input.idempotencyKey,
        );

      if (existing) {
        resolved = toEvent(existing);
        return;
      }

      const finalizing = await transaction.getFirstAsync<{ shift_id: string }>(
        "SELECT shift_id FROM shift_finalization_guards WHERE organization_id=? AND shift_id=? AND state='FINALIZING'",
        input.organizationId,
        input.shiftId,
      );
      if (finalizing) throw new Error("SHIFT_FINALIZATION_IN_PROGRESS");

      const state =
        await ensureDeviceSyncState(
          transaction,
          input.organizationId,
          input.deviceId,
        );

      if (
        !state
        || !Number.isSafeInteger(
          state.next_sequence,
        )
        || state.next_sequence < 1
      ) {
        throw new Error(
          "Invalid device sequence state.",
        );
      }

      const deviceSequence =
        state.next_sequence;

      const payload = {
        ...input.payload,
        offline: {
          ...input.payload.offline,
          deviceSequence,
        },
      };

      await transaction.runAsync(
        "INSERT INTO outbox_events (event_id,organization_id,store_id,register_id,device_id,device_sequence,shift_id,operation_type,idempotency_key,local_reference,payload_json,snapshot_json,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        input.eventId,
        input.organizationId,
        input.storeId,
        input.registerId,
        input.deviceId,
        deviceSequence,
        input.shiftId,
        "SALE_COMPLETED",
        input.idempotencyKey,
        input.localReference,
        JSON.stringify(payload),
        JSON.stringify(input.snapshot),
        "LOCAL_PENDING",
        input.createdAt,
        input.createdAt,
      );

      await transaction.runAsync(
        LOCAL_RECEIPT_INSERT_SQL,
        input.eventId,
        input.organizationId,
        input.storeId,
        input.registerId,
        input.localReference,
        input.snapshot.version,
        JSON.stringify(input.snapshot),
        input.createdAt,
      );

      const increment =
        await transaction.runAsync(
          "UPDATE device_sync_state SET next_sequence=next_sequence+1 WHERE organization_id=? AND device_id=? AND next_sequence=?",
          input.organizationId,
          input.deviceId,
          deviceSequence,
        );

      if (increment.changes !== 1) {
        throw new Error(
          "Device sequence allocation could not be committed.",
        );
      }

      const inserted =
        await transaction.getFirstAsync<OutboxRow>(
          "SELECT * FROM outbox_events WHERE event_id = ?",
          input.eventId,
        );

      resolved =
        inserted
          ? toEvent(inserted)
          : null;
    },
  );

  return resolved;
}

export async function listPendingOutboxEvents(organizationId: string, deviceId?: string) {
  const scoped = typeof deviceId === "string" && deviceId.length > 0;
  const rows = await (await getTindioDatabase()).getAllAsync<OutboxRow>(
    scoped
      ? "SELECT * FROM outbox_events WHERE organization_id = ? AND device_id = ? AND state = 'LOCAL_PENDING' ORDER BY device_sequence, created_at, event_id"
      : "SELECT * FROM outbox_events WHERE organization_id = ? AND state = 'LOCAL_PENDING' ORDER BY device_sequence, created_at, event_id",
    ...(scoped ? [organizationId, deviceId] : [organizationId]),
  );
  return rows.map(toEvent).filter((event): event is DurableOutboxEvent => event !== null);
}

function toRecoveryItem(row: OutboxRow): OutboxRecoveryItem {
  const event = toEvent(row);
  let snapshot: Partial<DurableOutboxEvent["snapshot"]> = {};
  try {
    snapshot = JSON.parse(row.snapshot_json) as Partial<DurableOutboxEvent["snapshot"]>;
  } catch {
    // The row stays visible and blocks FIFO even when its display snapshot is damaged.
  }
  return {
    eventId: row.event_id,
    organizationId: row.organization_id,
    storeId: row.store_id,
    registerId: row.register_id,
    deviceId: row.device_id,
    deviceSequence: Number.isSafeInteger(row.device_sequence) && row.device_sequence > 0
      ? row.device_sequence
      : null,
    employeeId: typeof snapshot.employeeId === "string" ? snapshot.employeeId : null,
    localReference: row.local_reference,
    state: row.state,
    createdAt: row.created_at,
    lastError: row.last_error,
    conflictType: row.conflict_type,
    currencyCode: typeof snapshot.currencyCode === "string" ? snapshot.currencyCode : null,
    totalMinor: Number.isSafeInteger(snapshot.totalMinor) ? snapshot.totalMinor! : null,
    itemCount: Number.isSafeInteger(snapshot.itemCount) ? snapshot.itemCount! : null,
    corrupt: event === null,
  };
}

export async function listUnresolvedOutboxEvents(organizationId: string, deviceId: string) {
  const rows = await (await getTindioDatabase()).getAllAsync<OutboxRow>(
    "SELECT * FROM outbox_events WHERE organization_id = ? AND device_id = ? AND state <> 'SYNCED' ORDER BY device_sequence, created_at, event_id",
    organizationId,
    deviceId,
  );
  return rows.map((row) => {
    const event = toEvent(row);
    if (!event) throw new Error("OUTBOX_ROW_CORRUPT");
    return event;
  });
}

export async function listOutboxRecoveryItems(
  organizationId: string,
  deviceId: string,
): Promise<OutboxRecoveryItem[]> {
  const rows = await (await getTindioDatabase()).getAllAsync<OutboxRow>(
    "SELECT * FROM outbox_events WHERE organization_id = ? AND device_id = ? AND state <> 'SYNCED' ORDER BY device_sequence, created_at, event_id",
    organizationId,
    deviceId,
  );
  return rows.map(toRecoveryItem);
}

export async function authorizeOutboxRecoveryRetry(input: {
  organizationId: string;
  deviceId: string;
  eventId: string;
  actorProfileId: string;
  actorEmployeeId: string;
  reason: string;
  authorizedAt?: string;
}) {
  const database = await getTindioDatabase();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const row = await transaction.getFirstAsync<OutboxRow>(
      "SELECT * FROM outbox_events WHERE organization_id=? AND device_id=? AND event_id=?",
      input.organizationId,
      input.deviceId,
      input.eventId,
    );
    if (!row || (row.state !== "FAILED" && row.state !== "CONFLICT")) {
      throw new Error("OUTBOX_RECOVERY_STATE_CHANGED");
    }

    const authorizedAt = input.authorizedAt ?? new Date().toISOString();
    const updated = await transaction.runAsync(
      OUTBOX_RECOVERY_UPDATE_SQL,
      `Retry authorized by employee ${input.actorEmployeeId}.`,
      authorizedAt,
      input.organizationId,
      input.deviceId,
      input.eventId,
      row.state,
    );
    if (updated.changes !== 1) throw new Error("OUTBOX_RECOVERY_STATE_CHANGED");

    await transaction.runAsync(
      OUTBOX_RECOVERY_AUDIT_SQL,
      input.organizationId,
      input.eventId,
      input.deviceId,
      input.actorProfileId,
      input.actorEmployeeId,
      row.state,
      row.last_error,
      row.conflict_type,
      "RETRY_AUTHORIZED",
      input.reason,
      authorizedAt,
    );
  });
}

export async function listReadyOutboxEvents(organizationId: string, now = new Date().toISOString(), deviceId?: string) {
  return (await listPendingOutboxEvents(organizationId, deviceId)).filter(
    (event) => event.nextRetryAt === null || event.nextRetryAt <= now,
  );
}

export async function recoverInterruptedOutboxEvents(organizationId: string, deviceId: string) {
  return (await getTindioDatabase()).runAsync(
    "UPDATE outbox_events SET state = 'LOCAL_PENDING', last_error = 'Recovered after interrupted sync attempt.', updated_at = ? WHERE organization_id = ? AND device_id = ? AND state = 'SYNCING'",
    new Date().toISOString(),
    organizationId,
    deviceId,
  );
}

export type OutboxEventUpdate = Partial<Pick<DurableOutboxEvent,
  "state" | "attempts" | "lastAttemptAt" | "nextRetryAt" | "syncedAt" | "lastError" |
  "conflictType" | "serverSaleId" | "officialReceiptNumber"
>>;

const UPDATE_COLUMNS: Record<keyof OutboxEventUpdate, string> = {
  state: "state", attempts: "attempts", lastAttemptAt: "last_attempt_at",
  nextRetryAt: "next_retry_at", syncedAt: "synced_at", lastError: "last_error",
  conflictType: "conflict_type", serverSaleId: "server_sale_id",
  officialReceiptNumber: "official_receipt_number",
};

export async function updateOutboxEvent(
  organizationId: string,
  eventId: string,
  changes: OutboxEventUpdate,
) {
  const entries =
    (
      Object.keys(changes) as Array<keyof OutboxEventUpdate>
    ).filter(
      (key) =>
        changes[key] !== undefined,
    );

  if (entries.length === 0) {
    return;
  }

  const assignments =
    entries
      .map(
        (key) =>
          `${UPDATE_COLUMNS[key]} = ?`,
      )
      .join(", ");

  await (
    await getTindioDatabase()
  ).runAsync(
    `UPDATE outbox_events SET ${assignments}, updated_at = ? WHERE organization_id = ? AND event_id = ?`,
    ...entries.map(
      (key) =>
        changes[key] ?? null,
    ),
    new Date().toISOString(),
    organizationId,
    eventId,
  );
}

export async function markOutboxEventSynced(input: {
  organizationId: string;
  eventId: string;
  serverSaleId: string;
  officialReceiptNumber: number;
  syncedAt: string;
}) {
  if (!input.serverSaleId || !Number.isSafeInteger(input.officialReceiptNumber) || input.officialReceiptNumber < 1) {
    throw new Error("Invalid official receipt acknowledgement.");
  }

  const database = await getTindioDatabase();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const receipt = await transaction.getFirstAsync<{
      server_sale_id: string | null;
      official_receipt_number: number | null;
    }>(
      "SELECT server_sale_id,official_receipt_number FROM local_receipts WHERE organization_id=? AND event_id=?",
      input.organizationId,
      input.eventId,
    );
    if (!receipt) throw new Error("Durable local receipt is missing.");

    const alreadyLinked = receipt.server_sale_id !== null || receipt.official_receipt_number !== null;
    if (alreadyLinked && (
      receipt.server_sale_id !== input.serverSaleId
      || receipt.official_receipt_number !== input.officialReceiptNumber
    )) {
      throw new Error("Official receipt acknowledgement conflicts with the committed link.");
    }

    if (!alreadyLinked) {
      const linked = await transaction.runAsync(
        OFFICIAL_RECEIPT_LINK_SQL,
        input.serverSaleId,
        input.officialReceiptNumber,
        input.syncedAt,
        input.organizationId,
        input.eventId,
      );
      if (linked.changes !== 1) throw new Error("Official receipt link could not be committed.");
    }

    const updated = await transaction.runAsync(
      OUTBOX_SYNC_ACK_SQL,
      input.syncedAt,
      input.serverSaleId,
      input.officialReceiptNumber,
      input.syncedAt,
      input.organizationId,
      input.eventId,
    );
    if (updated.changes !== 1) throw new Error("Outbox acknowledgement could not be committed.");
  });
}

export async function getOutboxSummary(organizationId: string): Promise<OutboxSummary> {
  const rows = await (await getTindioDatabase()).getAllAsync<{ state: OutboxState; count: number }>(
    "SELECT state, COUNT(*) AS count FROM outbox_events WHERE organization_id = ? GROUP BY state",
    organizationId,
  );
  const counts = Object.fromEntries(rows.map((row) => [row.state, row.count]));
  const pending = counts.LOCAL_PENDING ?? 0;
  const syncing = counts.SYNCING ?? 0;
  const synced = counts.SYNCED ?? 0;
  const conflict = counts.CONFLICT ?? 0;
  const failed = counts.FAILED ?? 0;
  return { pending, syncing, synced, conflict, failed, total: pending + syncing + synced + conflict + failed };
}

export async function getOldestUnresolvedOutboxEvent(organizationId: string): Promise<SafeOutboxEventSummary | null> {
  const row = await (await getTindioDatabase()).getFirstAsync<OutboxRow>(
    "SELECT * FROM outbox_events WHERE organization_id = ? AND state <> 'SYNCED' ORDER BY created_at, event_id LIMIT 1",
    organizationId,
  );
  const event = row ? toEvent(row) : null;
  return event ? {
    eventId: event.eventId, localReference: event.localReference, state: event.state, deviceSequence: event.deviceSequence,
    createdAt: event.createdAt, lastError: event.lastError, conflictType: event.conflictType,
    currencyCode: event.snapshot.currencyCode, totalMinor: event.snapshot.totalMinor,
    itemCount: event.snapshot.itemCount,
  } : null;
}
