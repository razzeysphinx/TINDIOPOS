import "server-only";

import { saveSmartMenuConfigurationSchema } from "@/features/smart-menu/smart-menu-schema";
import type { SmartMenuActionResult } from "@/features/smart-menu/smart-menu-types";
import { PERMISSION_DENIED_MESSAGE, postgresCodeMessage } from "@/lib/server/db-errors";
import { createClient } from "@/lib/supabase/server";

const SMART_MENU_DATABASE_MESSAGES: Record<string, string> = {
  "23514": "Check the Smart Menu selections and display settings.",
  "42501": PERMISSION_DENIED_MESSAGE,
  P0002: "Choose an active store for this Smart Menu.",
};

export async function saveSmartMenuConfiguration(
  input: unknown,
): Promise<SmartMenuActionResult<{ menuId: string }>> {
  const parsed = saveSmartMenuConfigurationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check the Smart Menu selections and display settings." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_smart_menu_configuration", {
    target_store_id: parsed.data.storeId,
    target_is_enabled: parsed.data.isEnabled,
    target_show_prices: parsed.data.showPrices,
    target_show_images: parsed.data.showImages,
    target_show_unavailable: parsed.data.showUnavailable,
    target_show_variants: parsed.data.showVariants,
    target_show_modifiers: parsed.data.showModifiers,
    target_category_ids: parsed.data.categoryIds,
    target_product_ids: parsed.data.productIds,
  });

  if (error || !data) {
    return {
      ok: false,
      message: postgresCodeMessage(
        error?.code,
        "TINDIO could not save this Smart Menu.",
        SMART_MENU_DATABASE_MESSAGES,
      ),
    };
  }

  return {
    ok: true,
    message: parsed.data.isEnabled
      ? "Smart Menu is live. Its public view now follows the selected catalog items."
      : "Smart Menu settings were saved. The public menu remains turned off.",
    data: { menuId: data },
  };
}
