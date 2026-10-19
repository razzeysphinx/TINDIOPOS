import type { CheckoutSaleValues } from "@tindio/contracts";
import { getTindioDatabase } from "./database";

export type OnlineCheckoutIntentState =
  | "PREPARED"
  | "SUBMITTING"
  | "UNKNOWN"
  | "ACKNOWLEDGED"
  | "REJECTED";

export type DurableOnlineCheckoutIntent = {
  intentId: string;
  organizationId: string;
  storeId: string;
  registerId: string;
  deviceId: string;
  employeeId: string;
  shiftId: string;
  idempotencyKey: string;
  payload: CheckoutSaleValues;
  state: OnlineCheckoutIntentState;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt: string | null;
  lastError: string | null;
  serverSaleId: string | null;
  officialReceiptNumber: number | null;
};

type IntentRow = {
  intent_id: string;
  organization_id: string;
  store_id: string;
  register_id: string;
  device_id: string;
  employee_id: string;
  shift_id: string;
  idempotency_key: string;
  payload_json: string;
  state: OnlineCheckoutIntentState;
  attempts: number;
  created_at: string;
  updated_at: string;
  last_attempt_at: string | null;
  last_error: string | null;
  server_sale_id: string | null;
  official_receipt_number: number | null;
};

export const INSERT_CHECKOUT_INTENT_SQL = `
  INSERT INTO checkout_intents (
    intent_id, organization_id, store_id, register_id, device_id, employee_id,
    shift_id, idempotency_key, payload_json, state, attempts, created_at, updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,'PREPARED',0,?,?)
  ON CONFLICT(organization_id, idempotency_key) DO NOTHING
`;

export const RECOVER_INTERRUPTED_CHECKOUT_INTENTS_SQL = `
  UPDATE checkout_intents
  SET state='UNKNOWN',
      updated_at=?,
      last_error='Recovered after an interrupted online checkout attempt.'
  WHERE organization_id=? AND device_id=? AND state='SUBMITTING'
`;

export const LOAD_UNRESOLVED_CHECKOUT_INTENT_SQL = `
  SELECT * FROM checkout_intents
  WHERE organization_id=?
    AND device_id=?
    AND state IN ('PREPARED','SUBMITTING','UNKNOWN')
  ORDER BY created_at, intent_id
  LIMIT 1
`;

export const MARK_CHECKOUT_INTENT_SUBMITTING_SQL = `
  UPDATE checkout_intents
  SET state='SUBMITTING', attempts=attempts+1, last_attempt_at=?, last_error=NULL, updated_at=?
  WHERE organization_id=? AND intent_id=? AND state IN ('PREPARED','UNKNOWN')
`;

export const MARK_CHECKOUT_INTENT_UNKNOWN_SQL = `
  UPDATE checkout_intents
  SET state='UNKNOWN', last_error=?, updated_at=?
  WHERE organization_id=? AND intent_id=? AND state IN ('PREPARED','SUBMITTING','UNKNOWN')
`;

export const MARK_CHECKOUT_INTENT_ACKNOWLEDGED_SQL = `
  UPDATE checkout_intents
  SET state='ACKNOWLEDGED', server_sale_id=?, official_receipt_number=?, last_error=NULL, updated_at=?
  WHERE organization_id=? AND intent_id=? AND state IN ('PREPARED','SUBMITTING','UNKNOWN')
`;

export const MARK_CHECKOUT_INTENT_REJECTED_SQL = `
  UPDATE checkout_intents
  SET state='REJECTED', last_error=?, updated_at=?
  WHERE organization_id=? AND intent_id=? AND state IN ('PREPARED','SUBMITTING','UNKNOWN')
`;

function decodeIntent(row: IntentRow | null): DurableOnlineCheckoutIntent | null {
  if (!row) return null;

  try {
    const payload = JSON.parse(row.payload_json) as CheckoutSaleValues;
    if (
      payload.idempotencyKey !== row.idempotency_key
      || payload.storeId !== row.store_id
      || payload.registerId !== row.register_id
    ) {
      throw new Error("ONLINE_CHECKOUT_INTENT_CORRUPT");
    }

    return {
      intentId: row.intent_id,
      organizationId: row.organization_id,
      storeId: row.store_id,
      registerId: row.register_id,
      deviceId: row.device_id,
      employeeId: row.employee_id,
      shiftId: row.shift_id,
      idempotencyKey: row.idempotency_key,
      payload,
      state: row.state,
      attempts: row.attempts,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastAttemptAt: row.last_attempt_at,
      lastError: row.last_error,
      serverSaleId: row.server_sale_id,
      officialReceiptNumber: row.official_receipt_number,
    };
  } catch (error) {
    if (
      error instanceof Error
      && error.message === "ONLINE_CHECKOUT_INTENT_CORRUPT"
    ) {
      throw error;
    }

    throw new Error("ONLINE_CHECKOUT_INTENT_CORRUPT");
  }
}

export async function prepareOnlineCheckoutIntent(input: {
  organizationId: string;
  deviceId: string;
  employeeId: string;
  shiftId: string;
  payload: CheckoutSaleValues;
}) {
  const database = await getTindioDatabase();
  const payloadJson = JSON.stringify(input.payload);
  const now = new Date().toISOString();
  let resolved: DurableOnlineCheckoutIntent | null = null;

  await database.withExclusiveTransactionAsync(async (transaction) => {
    const existing = await transaction.getFirstAsync<IntentRow>(
      "SELECT * FROM checkout_intents WHERE organization_id=? AND idempotency_key=?",
      input.organizationId,
      input.payload.idempotencyKey,
    );
    if (existing) {
      if (
        existing.payload_json !== payloadJson
        || existing.device_id !== input.deviceId
        || existing.employee_id !== input.employeeId
        || existing.shift_id !== input.shiftId
      ) throw new Error("ONLINE_CHECKOUT_IDENTITY_CONFLICT");
      resolved = decodeIntent(existing);
      return;
    }

    const finalizing = await transaction.getFirstAsync<{ shift_id: string }>(
      "SELECT shift_id FROM shift_finalization_guards WHERE organization_id=? AND shift_id=? AND state='FINALIZING'",
      input.organizationId,
      input.shiftId,
    );
    if (finalizing) throw new Error("SHIFT_FINALIZATION_IN_PROGRESS");

    await transaction.runAsync(
      INSERT_CHECKOUT_INTENT_SQL,
      input.payload.idempotencyKey,
      input.organizationId,
      input.payload.storeId,
      input.payload.registerId,
      input.deviceId,
      input.employeeId,
      input.shiftId,
      input.payload.idempotencyKey,
      payloadJson,
      now,
      now,
    );

    const row = await transaction.getFirstAsync<IntentRow>(
      "SELECT * FROM checkout_intents WHERE organization_id=? AND idempotency_key=?",
      input.organizationId,
      input.payload.idempotencyKey,
    );

    if (
      !row
      || row.payload_json !== payloadJson
      || row.device_id !== input.deviceId
      || row.employee_id !== input.employeeId
      || row.shift_id !== input.shiftId
    ) {
      throw new Error("ONLINE_CHECKOUT_IDENTITY_CONFLICT");
    }

    resolved = decodeIntent(row);
  });

  if (!resolved) throw new Error("ONLINE_CHECKOUT_INTENT_NOT_DURABLE");
  return resolved;
}

export async function recoverInterruptedOnlineCheckoutIntents(
  organizationId: string,
  deviceId: string,
) {
  const now = new Date().toISOString();
  return (await getTindioDatabase()).runAsync(
    RECOVER_INTERRUPTED_CHECKOUT_INTENTS_SQL,
    now,
    organizationId,
    deviceId,
  );
}

export async function getUnresolvedOnlineCheckoutIntent(
  organizationId: string,
  deviceId: string,
) {
  const row = await (await getTindioDatabase()).getFirstAsync<IntentRow>(
    LOAD_UNRESOLVED_CHECKOUT_INTENT_SQL,
    organizationId,
    deviceId,
  );
  return decodeIntent(row);
}

export async function markOnlineCheckoutIntentSubmitting(
  organizationId: string,
  intentId: string,
) {
  const now = new Date().toISOString();
  await (await getTindioDatabase()).runAsync(
    MARK_CHECKOUT_INTENT_SUBMITTING_SQL,
    now,
    now,
    organizationId,
    intentId,
  );
}

export async function markOnlineCheckoutIntentUnknown(
  organizationId: string,
  intentId: string,
  reason: string,
) {
  await (await getTindioDatabase()).runAsync(
    MARK_CHECKOUT_INTENT_UNKNOWN_SQL,
    reason,
    new Date().toISOString(),
    organizationId,
    intentId,
  );
}

export async function markOnlineCheckoutIntentAcknowledged(
  organizationId: string,
  intentId: string,
  result: { saleId: string; receiptNumber: number },
) {
  await (await getTindioDatabase()).runAsync(
    MARK_CHECKOUT_INTENT_ACKNOWLEDGED_SQL,
    result.saleId,
    result.receiptNumber,
    new Date().toISOString(),
    organizationId,
    intentId,
  );
}

export async function markOnlineCheckoutIntentRejected(
  organizationId: string,
  intentId: string,
  reason: string,
) {
  await (await getTindioDatabase()).runAsync(
    MARK_CHECKOUT_INTENT_REJECTED_SQL,
    reason,
    new Date().toISOString(),
    organizationId,
    intentId,
  );
}
