"use server";

import { revalidatePath } from "next/cache";

import { provisionCustomerDisplay } from "@/features/customer-display/service";
import type { CustomerDisplayActionResult } from "@/features/customer-display/customer-display-types";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";

export async function provisionCustomerDisplayAction(
  input: unknown,
): Promise<CustomerDisplayActionResult> {
  const context = await requireBusinessContext();

  if (!context.features.customer_display) {
    return { ok: false, message: "Customer display is disabled for this business." };
  }

  if (!hasPermission(context, "registers.manage")) {
    return { ok: false, message: "You do not have permission to manage customer displays." };
  }

  const result = await provisionCustomerDisplay({ context, input });
  if (result.ok) {
    revalidatePath("/back-office/registers");
  }

  return result;
}
