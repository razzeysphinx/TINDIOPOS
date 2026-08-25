"use server";

import { completeCheckout } from "@/features/checkout/checkout-service";
import type { CheckoutSaleActionResult } from "@/features/checkout/checkout-types";
import { requireBusinessContext } from "@/lib/auth/dal";

export type {
  CheckoutPaymentSummary,
  CheckoutSaleActionResult,
} from "@/features/checkout/checkout-types";

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
