"use server";

import { revalidatePath } from "next/cache";

import { saveSmartMenuConfiguration } from "@/features/smart-menu/service";
import type { SmartMenuActionResult } from "@/features/smart-menu/smart-menu-types";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";

export async function saveSmartMenuConfigurationAction(
  input: unknown,
): Promise<SmartMenuActionResult<{ menuId: string }>> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "settings.manage")) {
    return { ok: false, message: "You do not have permission to configure Smart Menu." };
  }

  const result = await saveSmartMenuConfiguration(input);
  if (result.ok) {
    revalidatePath("/back-office/smart-menu");
    revalidatePath("/menu/[menuId]", "page");
  }
  return result;
}
