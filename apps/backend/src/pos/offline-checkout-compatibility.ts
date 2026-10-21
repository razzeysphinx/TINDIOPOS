import {
  POS_OFFLINE_CHECKOUT_DEVICE_IDENTITY_MESSAGE,
  POS_OFFLINE_CHECKOUT_DEVICE_REVOKED_MESSAGE,
  POS_OFFLINE_CHECKOUT_DEVICE_RPC,
  POS_OFFLINE_CHECKOUT_FINALIZATION_MESSAGE,
  POS_OFFLINE_CHECKOUT_FINALIZE_RPC,
  POS_OFFLINE_CHECKOUT_INVALID_MESSAGE,
  POS_OFFLINE_CHECKOUT_NOTE_MESSAGE,
  POS_OFFLINE_CHECKOUT_PATH,
  POS_OFFLINE_CHECKOUT_PAYMENT_MESSAGE,
  POS_OFFLINE_CHECKOUT_PAYMENT_METHOD_MESSAGE,
  POS_OFFLINE_CHECKOUT_RECORD_RPC,
  POS_OFFLINE_CHECKOUT_RESERVATION_MESSAGE,
  POS_OFFLINE_CHECKOUT_RESERVE_RPC,
  POS_OFFLINE_CHECKOUT_SEQUENCE_MESSAGE,
  POS_OFFLINE_CHECKOUT_SEQUENCE_STATUSES,
  POS_OFFLINE_CHECKOUT_TOTAL_MESSAGE,
  POS_OFFLINE_CHECKOUT_UNCONFIRMED_MESSAGE,
  offlineCheckoutRequestSchema,
} from "@tindio/contracts/offline-checkout";
import {
  POS_CHECKOUT_RPC,
  checkoutSubmissionSchema,
  type CheckoutDeviceCredential,
  type CheckoutSaleActionResult,
  type CheckoutSaleValues,
  type CheckoutSequenceInfo,
  type CheckoutSubmission,
} from "@tindio/contracts/checkout";

import {
  toCheckoutRpcArguments,
  validateCheckout,
  type CheckoutCompatibilityContext,
} from "./checkout-compatibility.js";

export const OFFLINE_CHECKOUT_COMPATIBILITY_CONTRACT = {
  method: "POST",
  path: POS_OFFLINE_CHECKOUT_PATH,
  authentication: "supabase-business-context-before-json",
  organizationScope: "selected-header-or-authorized-default",
  requestOrder: "business-context-before-json-before-sequence-before-checkout",
  acceptedBodies: [
    "wrapped-checkout-device-optional-offline",
    "legacy-bare-checkout",
  ],
  sequenceModes: ["sequenced", "legacy-unsequenced"],
  deviceRpc: POS_OFFLINE_CHECKOUT_DEVICE_RPC,
  reserveRpc: POS_OFFLINE_CHECKOUT_RESERVE_RPC,
  checkoutRpc: POS_CHECKOUT_RPC,
  finalizeRpc: POS_OFFLINE_CHECKOUT_FINALIZE_RPC,
  recordRpc: POS_OFFLINE_CHECKOUT_RECORD_RPC,
  sequenceStatuses: POS_OFFLINE_CHECKOUT_SEQUENCE_STATUSES,
  checkoutGuard: "required-original-total-marker",
  paymentGuard: "exactly-one-cash-tender-with-offline-policy-cash",
  finalization: {
    success: "APPLIED",
    terminalFailure: "CONFLICT",
    retryableFailure: "leave-RECEIVED",
  },
  recording: "wrapped-offline-terminal-outcomes-only",
  actionResponses: {
    success: 200,
    conflict: 409,
    deviceRejected: 403,
    malformedJson: 400,
    retryable: 503,
    headers: { "cache-control": "private, no-store" },
  },
  malformedJsonMessage: POS_OFFLINE_CHECKOUT_INVALID_MESSAGE,
  unconfirmedMessage: POS_OFFLINE_CHECKOUT_UNCONFIRMED_MESSAGE,
} as const;

type OfflineMetadata = NonNullable<CheckoutSubmission["offline"]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function wrappedInput(value: unknown) {
  const parsed = checkoutSubmissionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type OfflineCheckoutValidation =
  | {
      ok: true;
      input: CheckoutSaleValues;
      device: CheckoutDeviceCredential | null | undefined;
      offline: OfflineMetadata | undefined;
      bodyShape: "wrapped" | "legacy";
      offlineTotalMarker: string;
    }
  | { ok: false; result: CheckoutSaleActionResult };

export function validateOfflineCheckout(
  value: unknown,
  context: CheckoutCompatibilityContext,
): OfflineCheckoutValidation {
  const checkout = validateCheckout(value, context);
  if (!checkout.ok) return checkout;

  const parsed = offlineCheckoutRequestSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      result: { ok: false, message: POS_OFFLINE_CHECKOUT_INVALID_MESSAGE, retryable: false },
    };
  }

  const offlineTotalMarker = checkout.input.offlineExpectedTotalMinor
    ? `[tindio-offline-total:${checkout.input.offlineExpectedTotalMinor}]`
    : null;
  if (!offlineTotalMarker) {
    return {
      ok: false,
      result: {
        ok: false,
        message: POS_OFFLINE_CHECKOUT_TOTAL_MESSAGE,
        retryable: false,
        failureCode: "DUPLICATE_TRANSACTION",
      },
    };
  }

  if (checkout.input.payments.some((payment) =>
    [payment.note, offlineTotalMarker].filter(Boolean).join(" ").length > 500
  )) {
    return {
      ok: false,
      result: { ok: false, message: POS_OFFLINE_CHECKOUT_NOTE_MESSAGE, retryable: false },
    };
  }

  const payment = checkout.input.payments[0];
  if (!payment || checkout.input.payments.length !== 1 || !payment.tenderedAmount) {
    return {
      ok: false,
      result: {
        ok: false,
        message: POS_OFFLINE_CHECKOUT_PAYMENT_MESSAGE,
        retryable: false,
        failureCode: "PERMISSION_CHANGED",
      },
    };
  }

  const wrapped = wrappedInput(value);
  return {
    ok: true,
    input: checkout.input,
    device: checkout.device,
    offline: wrapped?.offline,
    bodyShape: checkout.bodyShape,
    offlineTotalMarker,
  };
}

export function validateOfflinePaymentMethod(
  value: unknown,
  error: unknown,
): CheckoutSaleActionResult | null {
  if (error || !isRecord(value)
    || value.payment_type !== "CASH"
    || value.offline_policy !== "cash") {
    return {
      ok: false,
      message: POS_OFFLINE_CHECKOUT_PAYMENT_METHOD_MESSAGE,
      retryable: false,
      failureCode: "PERMISSION_CHANGED",
    };
  }
  return null;
}

export function toOfflineCheckoutRpcArguments(
  organizationId: string,
  input: CheckoutSaleValues,
) {
  const arguments_ = toCheckoutRpcArguments(organizationId, input);
  const marker = `[tindio-offline-total:${input.offlineExpectedTotalMinor}]`;
  return {
    ...arguments_,
    target_payments: arguments_.target_payments.map((payment, index) => {
      const note = [input.payments[index]?.note, marker].filter(Boolean).join(" ");
      return { ...payment, ...(note ? { note } : {}) };
    }),
  };
}

export type OfflineSequenceIntent =
  | { kind: "none" }
  | { kind: "rejected"; status: 409; result: CheckoutSaleActionResult }
  | {
      kind: "required";
      device: CheckoutDeviceCredential;
      offline: OfflineMetadata & { deviceSequence: number };
      checkout: CheckoutSaleValues;
    };

export function offlineSequenceIntent(value: unknown): OfflineSequenceIntent {
  const parsed = wrappedInput(value);
  if (!parsed?.offline || parsed.offline.deviceSequence === undefined) return { kind: "none" };
  if (!parsed.device || parsed.offline.deviceId !== parsed.device.deviceId) {
    return {
      kind: "rejected",
      status: 409,
      result: {
        ok: false,
        retryable: false,
        failureCode: "SEQUENCE_CONFLICT",
        message: POS_OFFLINE_CHECKOUT_DEVICE_IDENTITY_MESSAGE,
      },
    };
  }
  return {
    kind: "required",
    device: parsed.device,
    offline: parsed.offline as OfflineMetadata & { deviceSequence: number },
    checkout: parsed.checkout,
  };
}

export function validateOfflineDeviceBinding(
  value: unknown,
  error: unknown,
  intent: Extract<OfflineSequenceIntent, { kind: "required" }>,
): CheckoutSaleActionResult | null {
  const row = Array.isArray(value) ? value[0] : null;
  if (error || !isRecord(row)
    || String(row.device_id) !== intent.device.deviceId
    || String(row.store_id) !== intent.checkout.storeId
    || String(row.register_id) !== intent.checkout.registerId) {
    return {
      ok: false,
      retryable: false,
      failureCode: "DEVICE_REVOKED",
      message: POS_OFFLINE_CHECKOUT_DEVICE_REVOKED_MESSAGE,
    };
  }
  return null;
}

export function toOfflineSequenceReservationArguments(
  organizationId: string,
  intent: Extract<OfflineSequenceIntent, { kind: "required" }>,
) {
  return {
    target_organization_id: organizationId,
    target_device_id: intent.device.deviceId,
    target_store_id: intent.checkout.storeId,
    target_register_id: intent.checkout.registerId,
    target_device_sequence: intent.offline.deviceSequence,
    target_idempotency_key: intent.checkout.idempotencyKey,
    target_local_receipt_reference: intent.offline.localReceiptReference,
  };
}

function sequenceInfo(value: unknown, deviceSequence: number): CheckoutSequenceInfo | null {
  const row = Array.isArray(value) ? value[0] : null;
  if (!isRecord(row) || typeof row.status !== "string"
    || !POS_OFFLINE_CHECKOUT_SEQUENCE_STATUSES.includes(
      row.status as CheckoutSequenceInfo["status"],
    )) return null;
  const serverCheckpoint = Number(row.server_checkpoint);
  const expectedSequence = Number(row.expected_sequence);
  if (!Number.isSafeInteger(serverCheckpoint) || !Number.isSafeInteger(expectedSequence)) return null;
  return {
    deviceSequence,
    serverCheckpoint,
    expectedSequence,
    status: row.status as CheckoutSequenceInfo["status"],
  };
}

export type OfflineSequenceReservation =
  | { kind: "reserved"; sync: CheckoutSequenceInfo }
  | { kind: "rejected"; status: 409; result: CheckoutSaleActionResult }
  | { kind: "retryable"; status: 503; result: CheckoutSaleActionResult };

export function mapOfflineSequenceReservation(
  value: unknown,
  error: unknown,
  deviceSequence: number,
): OfflineSequenceReservation {
  const sync = sequenceInfo(value, deviceSequence);
  if (error || !sync) {
    return {
      kind: "retryable",
      status: 503,
      result: { ok: false, message: POS_OFFLINE_CHECKOUT_RESERVATION_MESSAGE, retryable: true },
    };
  }
  if (sync.status === "ACCEPTED" || sync.status === "REPLAY") {
    return { kind: "reserved", sync };
  }
  return {
    kind: "rejected",
    status: 409,
    result: {
      ok: false,
      retryable: false,
      failureCode: sync.status === "GAP"
        ? "SEQUENCE_GAP"
        : sync.status === "OUT_OF_ORDER"
          ? "SEQUENCE_OUT_OF_ORDER"
          : "SEQUENCE_CONFLICT",
      sync,
      message: POS_OFFLINE_CHECKOUT_SEQUENCE_MESSAGE,
    },
  };
}

export function offlineCheckoutFailureCode(
  code: string | undefined,
  message: string | undefined,
): Exclude<CheckoutSaleActionResult, { ok: true }>["failureCode"] {
  const normalized = (message ?? "").toLocaleLowerCase();
  if (code === "23505") return "DUPLICATE_TRANSACTION";
  if (code === "42501" && normalized.includes("device")) return "DEVICE_REVOKED";
  if (code === "42501" && normalized.includes("register")) return "REGISTER_REVOKED";
  if (code === "42501" && normalized.includes("shift")) return "INVALID_SHIFT";
  if (code === "42501") return "PERMISSION_CHANGED";
  if (normalized.includes("queued sale total changed") || normalized.includes("price")) {
    return "PRICE_CHANGED";
  }
  if (normalized.includes("tax")) return "TAX_CHANGED";
  if (normalized.includes("customer")) return "CUSTOMER_INVALID";
  if (normalized.includes("stock") || normalized.includes("inventory")) {
    return "INVENTORY_CONFLICT";
  }
  if (normalized.includes("active and available") || normalized.includes("archiv")) {
    return "PRODUCT_ARCHIVED";
  }
  if (normalized.includes("shift")) return "CLOSED_SHIFT";
  return "PERMISSION_CHANGED";
}

export function offlineSequenceFinalState(
  result: CheckoutSaleActionResult,
): "APPLIED" | "CONFLICT" | null {
  if (!result.ok && result.retryable) return null;
  return result.ok ? "APPLIED" : "CONFLICT";
}

export function mapOfflineSequenceFinalization(
  sync: CheckoutSequenceInfo,
  value: unknown,
  error: unknown,
): CheckoutSequenceInfo | CheckoutSaleActionResult {
  const row = Array.isArray(value) ? value[0] : null;
  const checkpoint = isRecord(row) ? Number(row.server_checkpoint) : Number.NaN;
  if (error || !Number.isSafeInteger(checkpoint)) {
    return {
      ok: false,
      message: POS_OFFLINE_CHECKOUT_FINALIZATION_MESSAGE,
      retryable: true,
    };
  }
  return { ...sync, serverCheckpoint: checkpoint, expectedSequence: checkpoint + 1 };
}

export function shouldRecordOfflineOutcome(
  value: unknown,
  result: CheckoutSaleActionResult,
): boolean {
  const parsed = wrappedInput(value);
  return Boolean(parsed?.offline) && (result.ok || !result.retryable);
}

export function toOfflineRecordArguments(
  organizationId: string,
  value: unknown,
  result: CheckoutSaleActionResult,
) {
  const parsed = checkoutSubmissionSchema.parse(value);
  const offline = parsed.offline!;
  const sequenceConflict = !result.ok && [
    "SEQUENCE_GAP", "SEQUENCE_CONFLICT", "SEQUENCE_OUT_OF_ORDER",
  ].includes(result.failureCode ?? "");
  const conflictType = result.ok
    ? null
    : sequenceConflict
      ? "PERMISSION_CHANGED"
      : result.failureCode ?? "PERMISSION_CHANGED";
  return {
    target_organization_id: organizationId,
    target_store_id: parsed.checkout.storeId,
    target_register_id: parsed.checkout.registerId,
    target_shift_id: offline.shiftId,
    target_device_id: offline.deviceId,
    target_idempotency_key: parsed.checkout.idempotencyKey,
    target_local_receipt_reference: offline.localReceiptReference,
    target_local_created_at: offline.createdAt,
    target_state: result.ok ? "SYNCED" : "CONFLICT",
    target_conflict_type: conflictType,
    target_failure_message: result.ok ? null : result.message,
    target_official_receipt_number: result.ok ? result.data.receiptNumber : null,
  };
}

export function offlineCheckoutResponseStatus(result: CheckoutSaleActionResult): 200 | 409 | 503 {
  return result.ok ? 200 : result.retryable ? 503 : 409;
}
