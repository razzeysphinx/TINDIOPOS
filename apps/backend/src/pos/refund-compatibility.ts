import {
  POS_REFUND_CONSTRAINT_DATABASE_CODE,
  POS_REFUND_DATABASE_MESSAGE,
  POS_REFUND_DATABASE_PERMISSION_MESSAGE,
  POS_REFUND_IDEMPOTENCY_DATABASE_CODE,
  POS_REFUND_IDEMPOTENCY_MESSAGE,
  POS_REFUND_INCOMPLETE_DATABASE_CODE,
  POS_REFUND_INCOMPLETE_MESSAGE,
  POS_REFUND_INPUT_MESSAGE,
  POS_REFUND_PATH_PATTERN,
  POS_REFUND_PERMISSION,
  POS_REFUND_PERMISSION_DATABASE_CODE,
  POS_REFUND_PERMISSION_MESSAGE,
  POS_REFUND_RECEIPT_INVALID_MESSAGE,
  POS_REFUND_RECEIPT_UNAVAILABLE_MESSAGE,
  POS_REFUND_REQUEST_INVALID_MESSAGE,
  POS_REFUND_RPC,
  posRefundPath,
  posRefundReceiptIdSchema,
  refundSaleSchema,
  type RefundDatabaseRow,
  type RefundSaleResult,
  type RefundSaleValues,
} from "@tindio/contracts/refund";

export const REFUND_COMPATIBILITY_CONTRACT = {
  method: "POST",
  path: POS_REFUND_PATH_PATTERN,
  pathBuilder: posRefundPath,
  authentication: "supabase-business-context-before-path-and-json",
  organizationScope: "selected-header-or-authorized-default",
  routeOrder: "business-context-before-path-before-json-before-receipt-before-refund-validation",
  receiptLookupRpc: "get_pos_receipt_detail",
  saleIdentity: "derived-from-immutable-receipt-detail-and-overrides-body",
  permission: POS_REFUND_PERMISSION,
  permissionOrApproval: true,
  rpc: POS_REFUND_RPC,
  idempotency: "organization-key-plus-actor-and-canonical-payload",
  stockEffect: "restore-only-explicit-or-default-return-to-stock-tracked-lines",
  paymentEffect: "one-enabled-original-store-method-for-calculated-total",
  actionResponses: {
    resultEnvelope: 200,
    malformedJsonOrReceipt: 400,
    unavailableReceipt: 404,
    headers: { "cache-control": "private, no-store" },
  },
} as const;

export type RefundContext = { permissions: readonly string[] };

export type RefundReceiptValidation =
  | { ok: true; receiptId: string }
  | { ok: false; status: 400; result: RefundSaleResult };

export function validateRefundReceiptId(value: unknown): RefundReceiptValidation {
  const parsed = posRefundReceiptIdSchema.safeParse(value);
  return parsed.success
    ? { ok: true, receiptId: parsed.data }
    : {
        ok: false,
        status: 400,
        result: { ok: false, message: POS_REFUND_RECEIPT_INVALID_MESSAGE },
      };
}

export function toReceiptScopedRefundInput(body: unknown, saleId: string): unknown {
  return {
    ...(body && typeof body === "object" ? body : {}),
    saleId,
  };
}

export type RefundValidation =
  | { ok: true; input: RefundSaleValues }
  | { ok: false; result: RefundSaleResult };

export function validateRefundSale(
  value: unknown,
  context: RefundContext,
): RefundValidation {
  const parsed = refundSaleSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, result: { ok: false, message: POS_REFUND_INPUT_MESSAGE } };
  }
  if (!context.permissions.includes(POS_REFUND_PERMISSION) && !parsed.data.approvalRequestId) {
    return { ok: false, result: { ok: false, message: POS_REFUND_PERMISSION_MESSAGE } };
  }
  return { ok: true, input: parsed.data };
}

export function toRefundRpcArguments(
  organizationId: string,
  input: RefundSaleValues,
) {
  return {
    target_organization_id: organizationId,
    target_sale_id: input.saleId,
    target_payment_method_id: input.paymentMethodId,
    target_idempotency_key: input.idempotencyKey,
    target_reason: input.reason,
    target_reference_number: input.referenceNumber || null,
    target_items: input.items.map((item) => ({
      sale_item_id: item.saleItemId,
      quantity: item.quantity,
      return_to_stock: item.returnToStock,
    })),
    ...(input.approvalRequestId
      ? { target_approval_request_id: input.approvalRequestId }
      : {}),
  };
}

type RefundDatabaseError = { code?: string; message?: string } | null;

export function mapRefundRpcResult(
  data: RefundDatabaseRow[] | null,
  error: RefundDatabaseError,
): RefundSaleResult {
  const row = data?.[0];
  if (error || !row) {
    const message = error?.message;
    return {
      ok: false,
      message:
        error?.code === POS_REFUND_PERMISSION_DATABASE_CODE
          ? POS_REFUND_DATABASE_PERMISSION_MESSAGE
          : error?.code === POS_REFUND_IDEMPOTENCY_DATABASE_CODE
            ? POS_REFUND_IDEMPOTENCY_MESSAGE
            : error?.code === POS_REFUND_CONSTRAINT_DATABASE_CODE && message
              ? message
              : error?.code === POS_REFUND_INCOMPLETE_DATABASE_CODE
                ? POS_REFUND_INCOMPLETE_MESSAGE
                : POS_REFUND_DATABASE_MESSAGE,
    };
  }
  return {
    ok: true,
    message: row.was_replayed
      ? `Refund #${row.refund_number} was already completed.`
      : `Refund #${row.refund_number} was completed.`,
    data: {
      refundId: row.refund_id,
      refundNumber: row.refund_number,
      totalMinor: row.total_minor,
      wasReplayed: row.was_replayed,
    },
  };
}

export const REFUND_ROUTE_MESSAGES = {
  malformedJson: POS_REFUND_REQUEST_INVALID_MESSAGE,
  invalidReceipt: POS_REFUND_RECEIPT_INVALID_MESSAGE,
  unavailableReceipt: POS_REFUND_RECEIPT_UNAVAILABLE_MESSAGE,
} as const;
