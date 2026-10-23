import {
  MOBILE_SHIFT_CUSTODY_CAPABILITY,
  POS_CASH_MOVEMENT_INVALID_MESSAGE,
  POS_CASH_MOVEMENT_PERMISSION_MESSAGE,
  POS_CASH_MOVEMENT_UNAVAILABLE_MESSAGE,
  POS_CASH_OPERATION_PERMISSION_MESSAGE,
  POS_CASH_PAY_IN_PERMISSION,
  POS_CASH_PAY_OUT_PERMISSION,
  POS_SHIFT_CASH_MOVEMENT_PATH,
  POS_SHIFT_CASH_MOVEMENT_RPC,
  POS_SHIFT_CLOSE_INVALID_MESSAGE,
  POS_SHIFT_CLOSE_PATH,
  POS_SHIFT_CLOSE_PENDING_CUSTODY_MESSAGE,
  POS_SHIFT_CLOSE_PERMISSION,
  POS_SHIFT_CLOSE_PERMISSION_MESSAGE,
  POS_SHIFT_CLOSE_RPC,
  POS_SHIFT_CLOSE_UNAVAILABLE_MESSAGE,
  POS_SHIFT_CUSTODY_INVALID_MESSAGE,
  POS_SHIFT_CUSTODY_PATH,
  POS_SHIFT_CUSTODY_RPC,
  POS_SHIFT_CUSTODY_UNAVAILABLE_MESSAGE,
  POS_SHIFT_OPEN_INVALID_MESSAGE,
  POS_SHIFT_OPEN_PATH,
  POS_SHIFT_OPEN_PERMISSION,
  POS_SHIFT_OPEN_PERMISSION_MESSAGE,
  POS_SHIFT_OPEN_RPC,
  POS_SHIFT_OPEN_UNAVAILABLE_MESSAGE,
  acquireShiftCustodySchema,
  cashMovementSchema,
  legacyMobileShiftCloseUpgrade,
  mobileCloseShiftSchema,
  openShiftSubmissionSchema,
  type AcquireShiftCustodySubmission,
  type CashMovementSubmission,
  type MobileCloseShiftSubmission,
  type OpenShiftSubmission,
  type PosCloseShiftV2Response,
  type PosOpenShiftV2Response,
} from "@tindio/contracts/shift-control";

export const SHIFT_CONTROL_COMPATIBILITY_CONTRACT = {
  authority: "next-route-handlers",
  method: "POST",
  authentication: "supabase-business-context-before-json",
  organizationScope: "selected-header-or-authorized-default",
  headers: { "cache-control": "private, no-store" },
  routes: {
    open: { path: POS_SHIFT_OPEN_PATH, permission: POS_SHIFT_OPEN_PERMISSION, rpc: POS_SHIFT_OPEN_RPC },
    close: { path: POS_SHIFT_CLOSE_PATH, permission: POS_SHIFT_CLOSE_PERMISSION, rpc: POS_SHIFT_CLOSE_RPC, legacyStatus: 426, capability: MOBILE_SHIFT_CUSTODY_CAPABILITY },
    custody: { path: POS_SHIFT_CUSTODY_PATH, rpc: POS_SHIFT_CUSTODY_RPC },
    cashMovement: { path: POS_SHIFT_CASH_MOVEMENT_PATH, permissions: [POS_CASH_PAY_IN_PERMISSION, POS_CASH_PAY_OUT_PERMISSION], rpc: POS_SHIFT_CASH_MOVEMENT_RPC },
  },
  custody: ["organization", "employee", "device", "store", "register", "shift", "checkpoint", "finalization-token"],
  retainedAuthority: ["register-open-uniqueness", "opening-employee", "active-device-lease", "cash-calculation", "permission-or-approval", "idempotency"],
} as const;

type Permissions = { permissions: readonly string[] };
type DatabaseError = { code?: string; message?: string } | null;
type Failure = { ok: false; status: 200 | 426; body: PosCloseShiftV2Response | PosOpenShiftV2Response | { ok: false; message: string } };
const failure = (message: string): Failure => ({ ok: false, status: 200, body: { ok: false, message } });

export function shiftMoneyInputToMinor(value: string): number {
  const [whole, fraction = ""] = value.trim().split(".");
  return Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
}

export function shiftDatabaseMessage(error: DatabaseError, fallback: string): string {
  if (error?.code === "42501" && error.message?.toLowerCase().includes("device")) return error.message;
  if (error?.code === "42501") return POS_CASH_OPERATION_PERMISSION_MESSAGE;
  if (error?.code === "23505" && error.message === "This register already has an open shift.") {
    return "This register has an open shift. Ask a staff member with Shift closing permission to review and close it before opening another.";
  }
  if (error?.code === "23505" && error.message) return error.message;
  if ((error?.code === "23514" || error?.code === "P0002") && error.message) return error.message;
  return fallback;
}

export function validateOpenShift(value: unknown, context: Permissions) {
  if (!context.permissions.includes(POS_SHIFT_OPEN_PERMISSION)) return failure(POS_SHIFT_OPEN_PERMISSION_MESSAGE);
  const parsed = openShiftSubmissionSchema.safeParse(value);
  return parsed.success ? { ok: true as const, input: parsed.data } : failure(POS_SHIFT_OPEN_INVALID_MESSAGE);
}

export function toOpenShiftRpcArguments(organizationId: string, input: OpenShiftSubmission) {
  return {
    target_organization_id: organizationId, target_store_id: input.storeId, target_register_id: input.registerId,
    target_opening_cash_minor: shiftMoneyInputToMinor(input.openingCash), target_opening_note: input.openingNote || null,
  };
}

export function mapOpenShiftResult(input: OpenShiftSubmission, data: Array<Record<string, unknown>> | null, error: DatabaseError): { status: 200; body: PosOpenShiftV2Response } {
  const row = data?.[0];
  if (error || !row) return { status: 200, body: { ok: false, message: shiftDatabaseMessage(error, POS_SHIFT_OPEN_UNAVAILABLE_MESSAGE) } };
  return { status: 200, body: { ok: true, message: row.was_replayed ? "This shift is already open." : "Register shift opened.", shift: {
    id: String(row.shift_id), storeId: input.storeId, registerId: input.registerId,
    openingCashMinor: shiftMoneyInputToMinor(input.openingCash), openedAt: String(row.opened_at),
  } } };
}

export function validateMobileCloseShift(value: unknown, context: Permissions) {
  if (!context.permissions.includes(POS_SHIFT_CLOSE_PERMISSION)) return failure(POS_SHIFT_CLOSE_PERMISSION_MESSAGE);
  const upgrade = legacyMobileShiftCloseUpgrade(value);
  if (upgrade) return { ok: false as const, status: 426 as const, body: upgrade };
  const parsed = mobileCloseShiftSchema.safeParse(value);
  return parsed.success ? { ok: true as const, input: parsed.data } : failure(POS_SHIFT_CLOSE_INVALID_MESSAGE);
}

export function toMobileCloseShiftRpcArguments(organizationId: string, input: MobileCloseShiftSubmission) {
  return {
    target_organization_id: organizationId, target_shift_id: input.shiftId,
    target_counted_cash_minor: shiftMoneyInputToMinor(input.countedCash), target_closing_note: input.closingNote || null,
    target_local_high_water: input.localHighWater, target_finalization_token: input.finalizationToken,
  };
}

export function mapMobileCloseShiftResult(data: Array<Record<string, unknown>> | null, error: DatabaseError): { status: 200; body: PosCloseShiftV2Response } {
  const row = data?.[0];
  if (error || !row) return { status: 200, body: { ok: false, message: shiftDatabaseMessage(error, POS_SHIFT_CLOSE_UNAVAILABLE_MESSAGE) } };
  if (row.closed !== true) return { status: 200, body: { ok: false, message: POS_SHIFT_CLOSE_PENDING_CUSTODY_MESSAGE } };
  return { status: 200, body: { ok: true, message: row.was_replayed ? "This shift close was already recorded." : "Shift closed and cash difference recorded.", closeSummary: {
    expectedCashMinor: Number(row.expected_cash_minor), countedCashMinor: Number(row.counted_cash_minor), differenceMinor: Number(row.difference_minor),
  } } };
}

export function validateShiftCustody(value: unknown) {
  const parsed = acquireShiftCustodySchema.safeParse(value);
  return parsed.success ? { ok: true as const, input: parsed.data } : failure(POS_SHIFT_CUSTODY_INVALID_MESSAGE);
}

export function toShiftCustodyRpcArguments(organizationId: string, input: AcquireShiftCustodySubmission) {
  return { target_organization_id: organizationId, target_shift_id: input.shiftId };
}

export function mapShiftCustodyResult(input: AcquireShiftCustodySubmission, data: Array<Record<string, unknown>> | null, error: DatabaseError) {
  const row = data?.[0];
  if (error || !row || String(row.device_id) !== input.device.deviceId) return { status: 200 as const, body: { ok: false as const, message: shiftDatabaseMessage(error, POS_SHIFT_CUSTODY_UNAVAILABLE_MESSAGE) } };
  return { status: 200 as const, body: { ok: true as const, deviceId: String(row.device_id), shiftId: String(row.shift_id), state: "ACTIVE" as const } };
}

export function validateCashMovement(value: unknown, context: Permissions) {
  const parsed = cashMovementSchema.safeParse(value);
  if (!parsed.success) return failure(POS_CASH_MOVEMENT_INVALID_MESSAGE);
  const permission = parsed.data.movementType === "PAY_IN" ? POS_CASH_PAY_IN_PERMISSION : POS_CASH_PAY_OUT_PERMISSION;
  return context.permissions.includes(permission) || parsed.data.approvalRequestId
    ? { ok: true as const, input: parsed.data }
    : failure(POS_CASH_MOVEMENT_PERMISSION_MESSAGE);
}

export function toCashMovementRpcArguments(organizationId: string, input: CashMovementSubmission) {
  return {
    target_organization_id: organizationId, target_shift_id: input.shiftId, target_movement_type: input.movementType,
    target_amount_minor: shiftMoneyInputToMinor(input.amount), target_reason: input.reason,
    target_idempotency_key: input.idempotencyKey,
    ...(input.approvalRequestId ? { target_approval_request_id: input.approvalRequestId } : {}),
  };
}

export function mapCashMovementResult(data: Array<Record<string, unknown>> | null, error: DatabaseError) {
  const row = data?.[0];
  return error || !row
    ? { status: 200 as const, body: { ok: false as const, message: shiftDatabaseMessage(error, POS_CASH_MOVEMENT_UNAVAILABLE_MESSAGE) } }
    : { status: 200 as const, body: { ok: true as const, message: row.was_replayed ? "That cash movement was already recorded." : "Cash movement recorded." } };
}
