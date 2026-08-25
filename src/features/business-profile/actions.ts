"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  businessTypes,
  featureKeys,
  type OrganizationFeatureSettings,
} from "@/features/business-profile/business-features";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

const updateBusinessProfileSchema = z.object({
  businessType: z.enum(businessTypes),
  features: z.record(z.string(), z.boolean()),
});

export type BusinessProfileActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

function isCompleteFeatureSettings(
  values: Record<string, boolean>,
): values is OrganizationFeatureSettings {
  const keys = Object.keys(values).sort();
  return keys.length === featureKeys.length && keys.every((key, index) => key === [...featureKeys].sort()[index]);
}

export async function updateBusinessProfileAction(
  input: unknown,
): Promise<BusinessProfileActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "settings.manage")) {
    return { ok: false, message: "You do not have permission to configure the business profile." };
  }

  const parsed = updateBusinessProfileSchema.safeParse(input);
  if (!parsed.success || !isCompleteFeatureSettings(parsed.data.features)) {
    return { ok: false, message: "Choose a business type and a valid setting for every feature." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_business_profile_features", {
    target_organization_id: context.organization.id,
    target_business_type: parsed.data.businessType,
    target_feature_settings: parsed.data.features as Json,
  });

  if (error) {
    return {
      ok: false,
      message: error.code === "42501"
        ? "You do not have permission to configure the business profile."
        : error.code === "22023"
          ? "The selected business profile or feature settings are invalid."
          : "TINDIO could not update the business profile. No settings were changed.",
    };
  }

  revalidatePath("/back-office", "layout");
  revalidatePath("/back-office/business-profile");
  revalidatePath("/back-office/advanced-sales");
  revalidatePath("/back-office/inventory");
  revalidatePath("/back-office/registers");
  revalidatePath("/back-office/time-clock");
  revalidatePath("/pos");
  revalidatePath("/kitchen");

  return { ok: true, message: "Business profile and feature settings updated." };
}
