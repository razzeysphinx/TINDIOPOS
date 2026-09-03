import "server-only";

import { moneyInputToMinor } from "@/features/catalog/catalog-money";
import {
  checkoutSaleSchema,
  checkoutSubmissionSchema,
  type CheckoutSaleValues,
} from "@/features/checkout/checkout-schema";
import { posDeviceRequestHeaders } from "@/features/devices/device-schema";
import type {
  CheckoutPaymentSummary,
  CheckoutSaleActionResult,
} from "@/features/checkout/checkout-types";
import { hasPermission, type BusinessContext } from "@/lib/auth/dal";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

function checkoutDatabaseMessage(
  code: string | undefined,
  message: string | undefined,
): string {
  if (code === "42501" && message?.toLowerCase().includes("device")) {
    return message;
  }

  if (code === "42501") {
    return "You do not have permission to complete this sale.";
  }

  if (code === "23505") {
    return "This checkout key belongs to a different transaction. Start a new checkout.";
  }

  if (code === "23514" && message) {
    return message;
  }

  if (code === "40001") {
    return "The prior checkout did not finish. Try again with a new checkout.";
  }

  if (code === "PGRST202") {
    return "The checkout service is refreshing. Reload the POS, wait a few seconds, then try again.";
  }

  if (code?.startsWith("PGRST")) {
    return "TINDIO's checkout service could not resolve this request. Reload the POS and try again.";
  }

  return "TINDIO could not complete this checkout. Nothing was charged or deducted.";
}

function offlineFailureCode(code: string | undefined, message: string | undefined) {
  const normalized = (message ?? "").toLocaleLowerCase();
  if (code === "23505") return "DUPLICATE_TRANSACTION" as const;
  if (code === "42501" && normalized.includes("device")) return "DEVICE_REVOKED" as const;
  if (code === "42501" && normalized.includes("register")) return "REGISTER_REVOKED" as const;
  if (code === "42501" && normalized.includes("shift")) return "INVALID_SHIFT" as const;
  if (code === "42501") return "PERMISSION_CHANGED" as const;
  if (normalized.includes("queued sale total changed") || normalized.includes("price")) {
    return "PRICE_CHANGED" as const;
  }
  if (normalized.includes("tax")) return "TAX_CHANGED" as const;
  if (normalized.includes("customer")) return "CUSTOMER_INVALID" as const;
  if (normalized.includes("stock") || normalized.includes("inventory")) {
    return "INVENTORY_CONFLICT" as const;
  }
  if (normalized.includes("active and available") || normalized.includes("archiv")) {
    return "PRODUCT_ARCHIVED" as const;
  }
  if (normalized.includes("shift")) return "CLOSED_SHIFT" as const;
  return "PERMISSION_CHANGED" as const;
}

function paymentSummaryFromDatabase(value: Json | null): CheckoutPaymentSummary[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((payment) => {
    if (!payment || typeof payment !== "object" || Array.isArray(payment)) return [];

    const record = payment as Record<string, Json | undefined>;
    const type = record.type;
    const supportedTypes = new Set([
      "CASH",
      "CARD",
      "E_WALLET",
      "BANK_TRANSFER",
      "VOUCHER",
      "OTHER",
    ]);

    if (
      typeof record.payment_method_id !== "string" ||
      typeof record.name !== "string" ||
      typeof record.code !== "string" ||
      typeof type !== "string" ||
      !supportedTypes.has(type) ||
      typeof record.amount_minor !== "number"
    ) {
      return [];
    }

    return [{
      paymentMethodId: record.payment_method_id,
      name: record.name,
      code: record.code,
      type: type as CheckoutPaymentSummary["type"],
      amountMinor: record.amount_minor,
      tenderedMinor:
        typeof record.amount_tendered_minor === "number"
          ? record.amount_tendered_minor
          : null,
      changeMinor:
        typeof record.change_given_minor === "number"
          ? record.change_given_minor
          : null,
      referenceNumber:
        typeof record.reference_number === "string" ? record.reference_number : null,
      note: typeof record.note === "string" ? record.note : null,
    }];
  });
}

export async function completeCheckout(
  context: BusinessContext,
  input: unknown,
  options: { guardOfflineTotal?: boolean } = {},
): Promise<CheckoutSaleActionResult> {
  if (
    !hasPermission(context, "pos.access")
    || !hasPermission(context, "sales.create")
    || !hasPermission(context, "payments.accept")
  ) {
    return {
      ok: false,
      message: "You do not have permission to complete sales.",
      retryable: false,
      failureCode: "PERMISSION_CHANGED",
    };
  }

  const wrapped = checkoutSubmissionSchema.safeParse(input);
  const legacy = wrapped.success ? null : checkoutSaleSchema.safeParse(input);
  const parsed = wrapped.success
    ? wrapped.data.checkout
    : legacy?.success
      ? legacy.data
      : null;
  if (!parsed) {
    return {
      ok: false,
      message: "Check the payments and cart, then try again.",
      retryable: false,
    };
  }

  if (!context.storeIds.includes(parsed.storeId)) {
    return {
      ok: false,
      message: "You are not assigned to this store.",
      retryable: false,
      failureCode: "PERMISSION_CHANGED",
    };
  }

  const data = parsed satisfies CheckoutSaleValues;
  if (data.discountId && !hasPermission(context, "discounts.apply")) {
    return {
      ok: false,
      message: "You do not have permission to apply discounts.",
      retryable: false,
      failureCode: "PERMISSION_CHANGED",
    };
  }

  if (data.openTicketId && !hasPermission(context, "tickets.manage")) {
    return {
      ok: false,
      message: "You do not have permission to use open tickets.",
      retryable: false,
      failureCode: "PERMISSION_CHANGED",
    };
  }

  const offlineTotalMarker = options.guardOfflineTotal
    ? data.offlineExpectedTotalMinor
      ? `[tindio-offline-total:${data.offlineExpectedTotalMinor}]`
      : null
    : null;

  if (options.guardOfflineTotal && !offlineTotalMarker) {
    return {
      ok: false,
      message: "The queued sale is missing its original total and needs review.",
      retryable: false,
      failureCode: "DUPLICATE_TRANSACTION",
    };
  }

  if (
    offlineTotalMarker &&
    data.payments.some((payment) =>
      [payment.note, offlineTotalMarker].filter(Boolean).join(" ").length > 500,
    )
  ) {
    return {
      ok: false,
      message: "This queued sale note is too long to sync safely and needs review.",
      retryable: false,
    };
  }

  const supabase = await createClient({ headers: posDeviceRequestHeaders(wrapped.success ? wrapped.data.device : null) });
  if (options.guardOfflineTotal) {
    const payment = data.payments[0];
    if (!payment || data.payments.length !== 1 || !payment.tenderedAmount) {
      return {
        ok: false,
        message: "Offline settlement requires one cached cash payment.",
        retryable: false,
        failureCode: "PERMISSION_CHANGED",
      };
    }

    const { data: method, error: methodError } = await supabase
      .from("payment_methods")
      .select("payment_type, offline_policy")
      .eq("organization_id", context.organization.id)
      .eq("id", payment.paymentMethodId)
      .maybeSingle();
    if (methodError || !method || method.payment_type !== "CASH" || method.offline_policy !== "cash") {
      return {
        ok: false,
        message: "This payment method no longer permits automatic offline cash settlement.",
        retryable: false,
        failureCode: "PERMISSION_CHANGED",
      };
    }
  }
  const { data: checkout, error } = await supabase.rpc("checkout_advanced_sale", {
    target_organization_id: context.organization.id,
    target_store_id: data.storeId,
    target_register_id: data.registerId,
    target_idempotency_key: data.idempotencyKey,
    // The checkout SQL routine accepts these optional UUIDs as null. Its
    // generated client signature currently loses that PostgreSQL nullability.
    target_customer_id: (data.customerId ?? null) as never,
    target_loyalty_redemption_points: data.loyaltyRedemptionPoints,
    target_discount_id: (data.discountId ?? null) as never,
    target_tax_rate_id: (data.taxRateId ?? null) as never,
    target_dining_option_id: (data.diningOptionId ?? null) as never,
    target_open_ticket_id: (data.openTicketId ?? null) as never,
    target_items: data.items.map((item) => {
      const itemNote = item.itemNote?.trim();

      return {
        product_id: item.productId,
        variant_id: item.variantId,
        quantity: item.quantity,
        unit_price_minor: item.unitPriceMinor ?? null,
        modifier_option_ids: item.modifierOptionIds,
        ...(itemNote ? { item_note: itemNote } : {}),
      };
    }) as Json,
    target_payments: data.payments.map((payment) => ({
      payment_method_id: payment.paymentMethodId,
      ...(payment.amount ? { amount_minor: moneyInputToMinor(payment.amount) } : {}),
      ...(payment.tenderedAmount
        ? { amount_tendered_minor: moneyInputToMinor(payment.tenderedAmount) }
        : {}),
      ...(payment.referenceNumber ? { reference_number: payment.referenceNumber } : {}),
      ...((payment.note || offlineTotalMarker)
        ? { note: [payment.note, offlineTotalMarker].filter(Boolean).join(" ") }
        : {}),
    })) as Json,
  });

  const result = checkout?.[0];
  if (error || !result) {
    const checkoutDiagnostic = {
      code: error?.code ?? "NO_RESULT",
      details: error?.details ?? null,
      hint: error?.hint ?? null,
      message: error?.message ?? "The checkout RPC returned no result.",
      organizationId: context.organization.id,
      registerId: data.registerId,
      storeId: data.storeId,
      payments: data.payments.map((payment) => ({
        paymentMethodId: payment.paymentMethodId,
        appliedMinor: payment.amount ? moneyInputToMinor(payment.amount) : null,
        tenderedMinor: payment.tenderedAmount ? moneyInputToMinor(payment.tenderedAmount) : null,
      })),
    };
    console.error("TINDIO checkout RPC rejected", JSON.stringify(checkoutDiagnostic));
    return {
      ok: false,
      message: checkoutDatabaseMessage(error?.code, error?.message),
      retryable: error?.code === "40001" || !error,
      ...(options.guardOfflineTotal && error?.code !== "40001" && error
        ? { failureCode: offlineFailureCode(error.code, error.message) }
        : {}),
    };
  }

  const { data: negativeItemCount } = await supabase.rpc("get_checkout_stock_warning", {
    target_organization_id: context.organization.id,
    target_store_id: data.storeId,
  });
  const inventoryWarning =
    typeof negativeItemCount === "number" && negativeItemCount > 0
      ? `${negativeItemCount} tracked ${negativeItemCount === 1 ? "item is" : "items are"} now below zero. Review Inventory before the next count or order.`
      : null;

  return {
    ok: true,
    message: result.was_replayed
      ? `Receipt #${result.receipt_number} was already completed.`
      : `Sale complete. Receipt #${result.receipt_number} is ready.`,
    data: {
      saleId: result.sale_id,
      receiptNumber: result.receipt_number,
      totalMinor: result.total_minor,
      changeMinor: result.change_minor,
      payments: paymentSummaryFromDatabase(result.payment_summary),
      wasReplayed: result.was_replayed,
      inventoryWarning,
    },
  };
}
