import {
  POS_CART_STOCK_INPUT_MESSAGE,
  POS_CART_STOCK_PERMISSION_MESSAGE,
  POS_CART_STOCK_SAFEGUARD_MESSAGE,
  POS_CART_STOCK_STORE_MESSAGE,
  POS_CART_STOCK_VALIDATION_PATH,
  POS_CART_STOCK_VALIDATION_PERMISSIONS,
  POS_CART_STOCK_VALIDATION_RPC,
  validateCartStockSchema,
  type NegativeStockItem,
  type NegativeStockPolicy,
  type ValidateCartStockActionResult,
  type ValidateCartStockValues,
} from "@tindio/contracts/checkout";
import {
  POS_STOCK_REQUEST_RECEIPT_DATABASE_MESSAGE,
  POS_STOCK_REQUEST_RECEIPT_ID_INVALID_MESSAGE,
  POS_STOCK_REQUEST_RECEIPT_INPUT_MESSAGE,
  POS_STOCK_REQUEST_RECEIPT_INVENTORY_DISABLED_MESSAGE,
  POS_STOCK_REQUEST_RECEIPT_PATH_PATTERN,
  POS_STOCK_REQUEST_RECEIPT_PERMISSION,
  POS_STOCK_REQUEST_RECEIPT_PERMISSION_MESSAGE,
  POS_STOCK_REQUEST_RECEIPT_RPC,
  POS_STOCK_REQUEST_RECEIPT_SUCCESS_MESSAGE,
  posStockRequestReceiptIdSchema,
  receiveStockRequestSchema,
  type ReceiveStockRequestValues,
  type StockRequestReceiptResult,
} from "@tindio/contracts/stock-request-receipt";

export const STOCK_OPERATIONS_COMPATIBILITY_CONTRACT = {
  authority: "next-route-handlers",
  authentication: "supabase-business-context-before-path-or-json",
  organizationScope: "selected-header-or-authorized-default",
  headers: { "cache-control": "private, no-store" },
  routes: {
    validateCart: {
      method: "POST",
      path: POS_CART_STOCK_VALIDATION_PATH,
      rpc: POS_CART_STOCK_VALIDATION_RPC,
      permissions: POS_CART_STOCK_VALIDATION_PERMISSIONS,
    },
    receiveRequest: {
      method: "POST",
      pathPattern: POS_STOCK_REQUEST_RECEIPT_PATH_PATTERN,
      rpc: POS_STOCK_REQUEST_RECEIPT_RPC,
      permission: POS_STOCK_REQUEST_RECEIPT_PERMISSION,
    },
  },
  custody: ["organization", "employee", "store", "register", "open-shift", "request", "transfer", "destination", "operation", "line-quantities"],
  retainedAuthority: ["negative-stock-policy", "made-to-order-components", "assigned-store", "request-state", "received-only-stock", "discrepancies", "idempotent-replay", "audit-log"],
} as const;

type DatabaseError = { code?: string | null; message?: string | null } | null;

export type StockOperationsCompatibilityContext = {
  permissions: readonly string[];
  assignedStoreIds: readonly string[];
  inventoryEnabled: boolean;
};

export function validateCartStockOperation(
  input: unknown,
  context: StockOperationsCompatibilityContext,
): { ok: true; input: ValidateCartStockValues } | { ok: false; result: ValidateCartStockActionResult } {
  if (!POS_CART_STOCK_VALIDATION_PERMISSIONS.every((permission) => context.permissions.includes(permission))) {
    return { ok: false, result: { ok: false, message: POS_CART_STOCK_PERMISSION_MESSAGE } };
  }
  const parsed = validateCartStockSchema.safeParse(input);
  if (!parsed.success) return { ok: false, result: { ok: false, message: POS_CART_STOCK_INPUT_MESSAGE } };
  if (!context.assignedStoreIds.includes(parsed.data.storeId)) {
    return { ok: false, result: { ok: false, message: POS_CART_STOCK_STORE_MESSAGE } };
  }
  return { ok: true, input: parsed.data };
}

export function toCartStockValidationRpcArguments(organizationId: string, input: ValidateCartStockValues) {
  return {
    target_organization_id: organizationId,
    target_store_id: input.storeId,
    target_register_id: input.registerId,
    target_items: input.items.map((item) => ({
      product_id: item.productId,
      variant_id: item.variantId,
      quantity: item.quantity,
    })),
  };
}

function checkoutDatabaseMessage(error: DatabaseError): string {
  const code = error?.code ?? undefined;
  const message = error?.message ?? undefined;
  if (code === "42501" && message?.toLowerCase().includes("device")) return message;
  if (code === "42501") return "You do not have permission to complete this sale.";
  if (code === "23505") return "This checkout key belongs to a different transaction. Start a new checkout.";
  if (code === "23514" && message) return message;
  if (code === "40001") return "The prior checkout did not finish. Try again with a new checkout.";
  if (code === "PGRST202") return "The checkout service is refreshing. Reload the POS, wait a few seconds, then try again.";
  if (code?.startsWith("PGRST")) return "TINDIO's checkout service could not resolve this request. Reload the POS and try again.";
  return "TINDIO could not complete this checkout. Nothing was charged or deducted.";
}

function stockItemFromDatabase(value: unknown): NegativeStockItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.product_id !== "string"
    || (item.variant_id !== null && typeof item.variant_id !== "string")
    || typeof item.product_name !== "string"
    || (item.variant_name !== null && typeof item.variant_name !== "string")) return null;
  const availableQuantity = Number(item.available_quantity);
  const cartQuantity = Number(item.cart_quantity);
  const projectedQuantity = Number(item.projected_quantity);
  if (![availableQuantity, cartQuantity, projectedQuantity].every(Number.isFinite)) return null;
  return { productId: item.product_id, variantId: item.variant_id, productName: item.product_name, variantName: item.variant_name, availableQuantity, cartQuantity, projectedQuantity };
}

export function mapCartStockValidationResult(
  data: unknown,
  error: DatabaseError,
  checkedAtFallback = new Date().toISOString(),
): ValidateCartStockActionResult {
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, message: checkoutDatabaseMessage(error) };
  }
  const payload = data as Record<string, unknown>;
  if (payload.policy !== "allow" && payload.policy !== "warn" && payload.policy !== "block") {
    return { ok: false, message: POS_CART_STOCK_SAFEGUARD_MESSAGE };
  }
  return {
    ok: true,
    policy: payload.policy satisfies NegativeStockPolicy,
    items: Array.isArray(payload.items) ? payload.items.flatMap((item) => {
      const mapped = stockItemFromDatabase(item);
      return mapped ? [mapped] : [];
    }) : [],
    checkedAt: typeof payload.checked_at === "string" ? payload.checked_at : checkedAtFallback,
  };
}

export function stockRequestIdFromReceiptPath(pathname: string): string | null {
  return POS_STOCK_REQUEST_RECEIPT_PATH_PATTERN.exec(pathname)?.[1] ?? null;
}

export function validateStockRequestReceiptId(stockRequestId: unknown) {
  const parsed = posStockRequestReceiptIdSchema.safeParse(stockRequestId);
  return parsed.success
    ? { ok: true as const, stockRequestId: parsed.data }
    : { ok: false as const, status: 400 as const, result: { ok: false as const, message: POS_STOCK_REQUEST_RECEIPT_ID_INVALID_MESSAGE } };
}

export function validateStockRequestReceipt(
  stockRequestId: string,
  input: unknown,
  context: StockOperationsCompatibilityContext,
): { ok: true; input: ReceiveStockRequestValues } | { ok: false; result: StockRequestReceiptResult } {
  if (!context.inventoryEnabled) {
    return { ok: false, result: { ok: false, message: POS_STOCK_REQUEST_RECEIPT_INVENTORY_DISABLED_MESSAGE } };
  }
  if (!context.permissions.includes(POS_STOCK_REQUEST_RECEIPT_PERMISSION)) {
    return { ok: false, result: { ok: false, message: POS_STOCK_REQUEST_RECEIPT_PERMISSION_MESSAGE } };
  }
  const body = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const parsed = receiveStockRequestSchema.safeParse({ ...body, stockRequestId });
  return parsed.success
    ? { ok: true, input: parsed.data }
    : { ok: false, result: { ok: false, message: POS_STOCK_REQUEST_RECEIPT_INPUT_MESSAGE } };
}

export function toStockRequestReceiptRpcArguments(organizationId: string, input: ReceiveStockRequestValues) {
  return {
    target_organization_id: organizationId,
    target_stock_request_id: input.stockRequestId,
    target_note: input.note,
    target_operation_id: input.operationId,
    target_lines: input.lines.map((line) => ({
      stock_transfer_line_id: line.stockTransferLineId,
      received_quantity: line.receivedQuantity,
      short_quantity: line.shortQuantity,
      discrepancy_note: line.discrepancyNote,
    })),
  };
}

export function stockRequestReceiptDatabaseMessage(error: DatabaseError): string {
  const messages: Record<string, string> = {
    "23505": "This warehouse, rule, or document already exists.",
    "23503": "Choose records that belong to this organization.",
    "23514": "The replenishment details violate a stock or workflow rule.",
    "22023": "The replenishment details violate a stock or workflow rule.",
    "42501": "You do not have permission or a store assignment for this replenishment operation.",
  };
  return error?.code && Object.hasOwn(messages, error.code)
    ? messages[error.code]!
    : POS_STOCK_REQUEST_RECEIPT_DATABASE_MESSAGE;
}

export function mapStockRequestReceiptResult(
  data: string | null,
  error: DatabaseError,
): StockRequestReceiptResult {
  if (error || !data) return { ok: false, message: stockRequestReceiptDatabaseMessage(error) };
  return { ok: true, message: POS_STOCK_REQUEST_RECEIPT_SUCCESS_MESSAGE, data: { stockRequestId: data } };
}
