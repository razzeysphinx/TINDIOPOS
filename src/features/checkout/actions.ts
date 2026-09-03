"use server";

import { completeCheckout, validateCartStock } from "@/features/checkout/checkout-service";
import type { CheckoutSaleActionResult, ValidateCartStockActionResult } from "@/features/checkout/checkout-types";
import { requireBusinessContext } from "@/lib/auth/dal";

export type {
  CheckoutPaymentSummary,
  CheckoutSaleActionResult,
  ValidateCartStockActionResult,
} from "@/features/checkout/checkout-types";

export async function validatePosCartStockAction(
  input: unknown,
): Promise<ValidateCartStockActionResult> {
  try {
    const context = await requireBusinessContext();
    return await validateCartStock(context, input);
  } catch (error) {
    console.error("TINDIO stock validation action failed", error);
    return { ok: false, message: "TINDIO could not refresh recorded stock. Check your connection and try again." };
  }
}

export async function checkoutSaleAction(
  input: unknown,
): Promise<CheckoutSaleActionResult> {
  try {
    const context = await requireBusinessContext();
    return await completeCheckout(context, input);
  } catch (error) {
    console.error("TINDIO checkout server action failed", error);
    return {
      ok: false,
      message: "TINDIO could not confirm this sale. Check Recent receipts before retrying.",
      retryable: true,
    };
  }
}
