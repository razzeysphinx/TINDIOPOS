import {
  POS_TRANSFER_RECEIPT_DATABASE_MESSAGE,
  POS_TRANSFER_RECEIPT_ID_INVALID_MESSAGE,
  POS_TRANSFER_RECEIPT_INPUT_MESSAGE,
  POS_TRANSFER_RECEIPT_INVENTORY_DISABLED_MESSAGE,
  POS_TRANSFER_RECEIPT_PATH_PATTERN,
  POS_TRANSFER_RECEIPT_PERMISSION,
  POS_TRANSFER_RECEIPT_PERMISSION_MESSAGE,
  POS_TRANSFER_RECEIPT_REQUEST_INVALID_MESSAGE,
  POS_TRANSFER_RECEIPT_RPC,
  POS_TRANSFER_RECEIPT_SUCCESS_MESSAGE,
  POS_TRANSFER_RECEIPT_TRANSFERS_DISABLED_MESSAGE,
  posTransferReceiptIdSchema,
  posTransferReceiptPath,
  receiveStockTransferSchema,
  type ReceiveStockTransferValues,
  type TransferReceiptResult,
} from "@tindio/contracts/transfer-receipt";

export const TRANSFER_RECEIPT_COMPATIBILITY_CONTRACT = {
  method: "POST",
  path: POS_TRANSFER_RECEIPT_PATH_PATTERN,
  pathBuilder: posTransferReceiptPath,
  authentication: "supabase-business-context-before-path-and-json",
  organizationScope: "selected-header-or-authorized-default",
  routeOrder: "business-context-before-path-before-json-before-validation",
  transferIdentity: "path-overrides-body",
  permission: POS_TRANSFER_RECEIPT_PERMISSION,
  rpc: POS_TRANSFER_RECEIPT_RPC,
  idempotency: "organization-operation-key-plus-canonical-payload",
  destinationCustody: "active-employee-assigned-to-destination-store",
  stockEffect: "received-quantity-only-transfer-in-at-destination",
  actionResponses: {
    resultEnvelope: 200,
    malformedJsonOrTransfer: 400,
    headers: { "cache-control": "private, no-store" },
  },
} as const;

export type TransferReceiptContext = {
  inventoryEnabled: boolean;
  transfersEnabled: boolean;
  permissions: readonly string[];
};

export function validateTransferReceiptId(value: unknown) {
  const parsed = posTransferReceiptIdSchema.safeParse(value);
  return parsed.success
    ? { ok: true as const, transferId: parsed.data }
    : {
        ok: false as const,
        status: 400 as const,
        result: { ok: false as const, message: POS_TRANSFER_RECEIPT_ID_INVALID_MESSAGE },
      };
}

export function toTransferScopedReceiptInput(body: unknown, transferId: string): unknown {
  return {
    ...(body && typeof body === "object" ? body : {}),
    stockTransferId: transferId,
  };
}

export function validateTransferReceipt(
  value: unknown,
  context: TransferReceiptContext,
): { ok: true; input: ReceiveStockTransferValues } | { ok: false; result: TransferReceiptResult } {
  if (!context.inventoryEnabled) {
    return { ok: false, result: { ok: false, message: POS_TRANSFER_RECEIPT_INVENTORY_DISABLED_MESSAGE } };
  }
  if (!context.permissions.includes(POS_TRANSFER_RECEIPT_PERMISSION)) {
    return { ok: false, result: { ok: false, message: POS_TRANSFER_RECEIPT_PERMISSION_MESSAGE } };
  }
  if (!context.transfersEnabled) {
    return { ok: false, result: { ok: false, message: POS_TRANSFER_RECEIPT_TRANSFERS_DISABLED_MESSAGE } };
  }
  const parsed = receiveStockTransferSchema.safeParse(value);
  return parsed.success
    ? { ok: true, input: parsed.data }
    : { ok: false, result: { ok: false, message: POS_TRANSFER_RECEIPT_INPUT_MESSAGE } };
}

export function toTransferReceiptRpcArguments(
  organizationId: string,
  input: ReceiveStockTransferValues,
) {
  return {
    target_organization_id: organizationId,
    target_stock_transfer_id: input.stockTransferId,
    target_note: input.note,
    target_operation_id: input.operationId,
    target_lines: input.lines.map((line) => ({
      stock_transfer_line_id: line.stockTransferLineId,
      received_quantity: line.receivedQuantity,
      short_quantity: line.shortQuantity,
      discrepancy_note: line.discrepancyNote || null,
    })),
  };
}

const DATABASE_MESSAGES: Record<string, string> = {
  "23505": "This supplier or inventory document already exists.",
  "23503": "Choose records that belong to this organization.",
  "23514": "The inventory details violate a business rule. Check available stock and quantities.",
  "22023": "The inventory details violate a business rule. Check available stock and quantities.",
  "42501": "You do not have permission to make this inventory change.",
};

export function mapTransferReceiptRpcResult(
  data: string | null,
  error: { code?: string } | null,
): TransferReceiptResult {
  if (error || !data) {
    return {
      ok: false,
      message: (error?.code && DATABASE_MESSAGES[error.code]) || POS_TRANSFER_RECEIPT_DATABASE_MESSAGE,
    };
  }
  return {
    ok: true,
    message: POS_TRANSFER_RECEIPT_SUCCESS_MESSAGE,
    data: { receiptId: data },
  };
}

export const TRANSFER_RECEIPT_ROUTE_MESSAGES = {
  malformedJson: POS_TRANSFER_RECEIPT_REQUEST_INVALID_MESSAGE,
  invalidTransfer: POS_TRANSFER_RECEIPT_ID_INVALID_MESSAGE,
} as const;
