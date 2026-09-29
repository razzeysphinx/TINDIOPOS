import { getTindioDatabase } from "./database";
import { ensureDeviceSyncState } from "./device-sync-state";
import type {
  DurableOutboxEvent,
  NewDurableOutboxEvent,
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

export async function listReadyOutboxEvents(organizationId: string, now = new Date().toISOString(), deviceId?: string) {
  return (await listPendingOutboxEvents(organizationId, deviceId)).filter(
    (event) => event.nextRetryAt === null || event.nextRetryAt <= now,
  );
}

export async function recoverInterruptedOutboxEvents(organizationId: string, now = Date.now(), deviceId?: string) {
  const scoped = typeof deviceId === "string" && deviceId.length > 0;
  return (await getTindioDatabase()).runAsync(
    scoped
      ? "UPDATE outbox_events SET state = 'LOCAL_PENDING', last_error = 'Recovered after interrupted sync attempt.', updated_at = ? WHERE organization_id = ? AND device_id = ? AND state = 'SYNCING' AND last_attempt_at < ?"
      : "UPDATE outbox_events SET state = 'LOCAL_PENDING', last_error = 'Recovered after interrupted sync attempt.', updated_at = ? WHERE organization_id = ? AND state = 'SYNCING' AND last_attempt_at < ?",
    ...(scoped
      ? [new Date(now).toISOString(), organizationId, deviceId, new Date(now - 60_000).toISOString()]
      : [new Date(now).toISOString(), organizationId, new Date(now - 60_000).toISOString()]),
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

export async function updateOutboxEvent(eventId: string, changes: OutboxEventUpdate) {
  const entries = (Object.keys(changes) as Array<keyof OutboxEventUpdate>).filter(
    (key) => changes[key] !== undefined,
  );
  if (entries.length === 0) return;
  const assignments = entries.map((key) => `${UPDATE_COLUMNS[key]} = ?`).join(", ");
  await (await getTindioDatabase()).runAsync(
    `UPDATE outbox_events SET ${assignments}, updated_at = ? WHERE event_id = ?`,
    ...entries.map((key) => changes[key] ?? null), new Date().toISOString(), eventId,
  );
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
