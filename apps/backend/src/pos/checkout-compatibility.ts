import {
  POS_CHECKOUT_DISCOUNT_MESSAGE,
  POS_CHECKOUT_DISCOUNT_PERMISSION,
  POS_CHECKOUT_INPUT_MESSAGE,
  POS_CHECKOUT_PATH,
  POS_CHECKOUT_PERMISSION_MESSAGE,
  POS_CHECKOUT_PERMISSIONS,
  POS_CHECKOUT_REQUEST_INVALID_MESSAGE,
  POS_CHECKOUT_RPC,
  POS_CHECKOUT_STOCK_WARNING_RPC,
  POS_CHECKOUT_STORE_MESSAGE,
  POS_CHECKOUT_TICKET_MESSAGE,
  POS_CHECKOUT_TICKET_PERMISSION,
  POS_CHECKOUT_UNCONFIRMED_MESSAGE,
  checkoutSaleSchema,
  checkoutSubmissionSchema,
  type CheckoutDeviceCredential,
  type CheckoutPaymentSummary,
  type CheckoutSaleActionResult,
  type CheckoutSaleValues,
} from "@tindio/contracts/checkout";

export const CHECKOUT_COMPATIBILITY_CONTRACT = {
  method: "POST",
  path: POS_CHECKOUT_PATH,
  authentication: "supabase-verified-three-part-bearer",
  organizationScope: "selected-header-or-authorized-default",
  requestOrder: "json-before-business-context",
  permissions: POS_CHECKOUT_PERMISSIONS,
  conditionalPermissions: {
    discount: POS_CHECKOUT_DISCOUNT_PERMISSION,
    openTicket: POS_CHECKOUT_TICKET_PERMISSION,
  },
  rpc: POS_CHECKOUT_RPC,
  stockWarningRpc: POS_CHECKOUT_STOCK_WARNING_RPC,
  rpcArguments: [
    "target_organization_id",
    "target_store_id",
    "target_register_id",
    "target_idempotency_key",
    "target_customer_id",
    "target_loyalty_redemption_points",
    "target_discount_id",
    "target_tax_rate_id",
    "target_dining_option_id",
    "target_open_ticket_id",
    "target_items",
    "target_payments",
  ],
  acceptedBodies: ["wrapped-checkout-and-device", "legacy-bare-checkout"],
  storeRegisterCustody: "active-assigned-employee-and-active-register",
  shiftCustody: "first-commit-requires-owned-open-shift;completed-replay-does-not",
  deviceCustody: "wrapped-device-forwarded-as-rpc-headers;shift-open-enforces-device",
  idempotency: "organization-key-plus-actor-and-canonical-payload",
  itemBounds: { minimum: 1, maximum: 100, quantityScale: 3 },
  paymentBounds: { minimum: 1, maximum: 10, moneyScale: 2 },
  paymentSemantics: [
    "one-of-applied-or-tendered",
    "enabled-store-method",
    "reference-when-required",
    "exact-sale-total",
    "cash-change-only",
  ],
  stockSemantics: [
    "atomic-sale-and-stock-write",
    "effective-negative-stock-policy",
    "made-to-order-component-consumption",
    "best-effort-post-commit-warning",
  ],
  financialEffects: [
    "sale-and-line-snapshots",
    "payment-snapshots",
    "receipt-number",
    "inventory-movements",
    "loyalty-ledger",
    "open-ticket-completion",
  ],
  actionResponses: {
    success: 200,
    conflict: 409,
    retryable: 503,
    headers: { "cache-control": "private, no-store" },
  },
  malformedJsonResponse: {
    status: 400,
    headers: { "cache-control": "private, no-store" },
    body: {
      ok: false,
      message: POS_CHECKOUT_REQUEST_INVALID_MESSAGE,
      retryable: false,
    },
  },
  unconfirmedResponse: {
    status: 500,
    headers: { "cache-control": "private, no-store" },
    body: { ok: false, message: POS_CHECKOUT_UNCONFIRMED_MESSAGE, retryable: true },
  },
} as const;

export type CheckoutCompatibilityContext = {
  permissions: readonly string[];
  assignedStoreIds: readonly string[];
};

export type CheckoutCompatibilityValidation =
  | {
      ok: true;
      input: CheckoutSaleValues;
      device: CheckoutDeviceCredential | null | undefined;
      bodyShape: "wrapped" | "legacy";
    }
  | { ok: false; result: CheckoutSaleActionResult };

const denied = (message: string): CheckoutCompatibilityValidation => ({
  ok: false,
  result: {
    ok: false,
    message,
    retryable: false,
    failureCode: "PERMISSION_CHANGED",
  },
});

export function validateCheckout(
  value: unknown,
  context: CheckoutCompatibilityContext,
): CheckoutCompatibilityValidation {
  if (!POS_CHECKOUT_PERMISSIONS.every((permission) => context.permissions.includes(permission))) {
    return denied(POS_CHECKOUT_PERMISSION_MESSAGE);
  }

  const wrapped = checkoutSubmissionSchema.safeParse(value);
  const legacy = wrapped.success ? null : checkoutSaleSchema.safeParse(value);
  const input = wrapped.success ? wrapped.data.checkout : legacy?.success ? legacy.data : null;

  if (!input) {
    return {
      ok: false,
      result: { ok: false, message: POS_CHECKOUT_INPUT_MESSAGE, retryable: false },
    };
  }

  if (!context.assignedStoreIds.includes(input.storeId)) {
    return denied(POS_CHECKOUT_STORE_MESSAGE);
  }

  if (input.discountId && !context.permissions.includes(POS_CHECKOUT_DISCOUNT_PERMISSION)) {
    return denied(POS_CHECKOUT_DISCOUNT_MESSAGE);
  }

  if (input.openTicketId && !context.permissions.includes(POS_CHECKOUT_TICKET_PERMISSION)) {
    return denied(POS_CHECKOUT_TICKET_MESSAGE);
  }

  return {
    ok: true,
    input,
    device: wrapped?.success ? wrapped.data.device : undefined,
    bodyShape: wrapped?.success ? "wrapped" : "legacy",
  };
}

function moneyInputToMinor(value: string) {
  const [whole, fraction = ""] = value.trim().split(".");
  return Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
}

export function toCheckoutRpcArguments(
  organizationId: string,
  input: CheckoutSaleValues,
) {
  return {
    target_organization_id: organizationId,
    target_store_id: input.storeId,
    target_register_id: input.registerId,
    target_idempotency_key: input.idempotencyKey,
    target_customer_id: input.customerId ?? null,
    target_loyalty_redemption_points: input.loyaltyRedemptionPoints,
    target_discount_id: input.discountId ?? null,
    target_tax_rate_id: input.taxRateId ?? null,
    target_dining_option_id: input.diningOptionId ?? null,
    target_open_ticket_id: input.openTicketId ?? null,
    target_items: input.items.map((item) => {
      const note = item.itemNote?.trim();
      return {
        product_id: item.productId,
        variant_id: item.variantId,
        quantity: item.quantity,
        unit_price_minor: item.unitPriceMinor ?? null,
        modifier_option_ids: item.modifierOptionIds,
        ...(note ? { item_note: note } : {}),
      };
    }),
    target_payments: input.payments.map((payment) => ({
      payment_method_id: payment.paymentMethodId,
      ...(payment.amount ? { amount_minor: moneyInputToMinor(payment.amount) } : {}),
      ...(payment.tenderedAmount
        ? { amount_tendered_minor: moneyInputToMinor(payment.tenderedAmount) }
        : {}),
      ...(payment.referenceNumber ? { reference_number: payment.referenceNumber } : {}),
      ...(payment.note ? { note: payment.note } : {}),
    })),
  };
}

type CheckoutRpcError = {
  code?: string | null;
  message?: string | null;
};

export type CheckoutRpcRow = {
  sale_id: string;
  receipt_number: number;
  total_minor: number;
  change_minor: number;
  payment_summary: unknown;
  was_replayed: boolean;
};

function checkoutDatabaseMessage(error: CheckoutRpcError | null) {
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

function paymentSummaryFromDatabase(value: unknown): CheckoutPaymentSummary[] {
  if (!Array.isArray(value)) return [];
  const supportedTypes = new Set(["CASH", "CARD", "E_WALLET", "BANK_TRANSFER", "VOUCHER", "OTHER"]);

  return value.flatMap((payment) => {
    if (!payment || typeof payment !== "object" || Array.isArray(payment)) return [];
    const record = payment as Record<string, unknown>;
    if (
      typeof record.payment_method_id !== "string"
      || typeof record.name !== "string"
      || typeof record.code !== "string"
      || typeof record.type !== "string"
      || !supportedTypes.has(record.type)
      || typeof record.amount_minor !== "number"
    ) return [];

    return [{
      paymentMethodId: record.payment_method_id,
      name: record.name,
      code: record.code,
      type: record.type as CheckoutPaymentSummary["type"],
      amountMinor: record.amount_minor,
      tenderedMinor: typeof record.amount_tendered_minor === "number" ? record.amount_tendered_minor : null,
      changeMinor: typeof record.change_given_minor === "number" ? record.change_given_minor : null,
      referenceNumber: typeof record.reference_number === "string" ? record.reference_number : null,
      note: typeof record.note === "string" ? record.note : null,
    }];
  });
}

export function mapCheckoutRpcResult(
  row: CheckoutRpcRow | null,
  error: CheckoutRpcError | null,
  negativeStockItemCount: number | null = null,
): CheckoutSaleActionResult {
  if (error || !row) {
    return {
      ok: false,
      message: checkoutDatabaseMessage(error),
      retryable: error?.code === "40001" || !error,
    };
  }

  const inventoryWarning =
    typeof negativeStockItemCount === "number" && negativeStockItemCount > 0
      ? `${negativeStockItemCount} tracked ${negativeStockItemCount === 1 ? "item is" : "items are"} now below zero. Review Inventory before the next count or order.`
      : null;

  return {
    ok: true,
    message: row.was_replayed
      ? `Receipt #${row.receipt_number} was already completed.`
      : `Sale complete. Receipt #${row.receipt_number} is ready.`,
    data: {
      saleId: row.sale_id,
      receiptNumber: row.receipt_number,
      totalMinor: row.total_minor,
      changeMinor: row.change_minor,
      payments: paymentSummaryFromDatabase(row.payment_summary),
      wasReplayed: row.was_replayed,
      inventoryWarning,
    },
  };
}
