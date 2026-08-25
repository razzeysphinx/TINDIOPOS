import "server-only";

import {
  featureKeys,
  type OrganizationFeatureSettings,
} from "@/features/business-profile/business-features";
import { updateBusinessProfileSchema } from "@/features/business-profile/business-profile-schema";
import type { BusinessProfileActionResult } from "@/features/business-profile/business-profile-types";
import type { BusinessContext } from "@/lib/auth/dal";
import { postgresCodeMessage } from "@/lib/server/db-errors";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

function isCompleteFeatureSettings(
  values: Record<string, boolean>,
): values is OrganizationFeatureSettings {
  const keys = Object.keys(values).sort();
  return keys.length === featureKeys.length && keys.every((key, index) => key === [...featureKeys].sort()[index]);
}

export async function updateBusinessProfile({
  context,
  input,
}: {
  context: BusinessContext;
  input: unknown;
}): Promise<BusinessProfileActionResult> {
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
      message: postgresCodeMessage(
        error.code,
        "TINDIO could not update the business profile. No settings were changed.",
        {
          "42501": "You do not have permission to configure the business profile.",
          "22023": "The selected business profile or feature settings are invalid.",
        },
      ),
    };
  }

  return { ok: true, message: "Business profile and feature settings updated." };
}
