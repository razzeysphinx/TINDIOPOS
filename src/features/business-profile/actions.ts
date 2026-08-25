"use server";

import { revalidatePath } from "next/cache";

import { updateBusinessProfile } from "@/features/business-profile/service";
import type { BusinessProfileActionResult } from "@/features/business-profile/business-profile-types";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";

function revalidateBusinessProfileViews() {
  revalidatePath("/back-office", "layout");
  revalidatePath("/back-office/business-profile");
  revalidatePath("/back-office/advanced-sales");
  revalidatePath("/back-office/inventory");
  revalidatePath("/back-office/registers");
  revalidatePath("/back-office/time-clock");
  revalidatePath("/pos");
  revalidatePath("/kitchen");
}

export async function updateBusinessProfileAction(
  input: unknown,
): Promise<BusinessProfileActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "settings.manage")) {
    return { ok: false, message: "You do not have permission to configure the business profile." };
  }

  const result = await updateBusinessProfile({ context, input });
  if (result.ok) {
    revalidateBusinessProfileViews();
  }

  return result;
}
