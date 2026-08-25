import "server-only";

import { cookies } from "next/headers";

import { onboardingSchema } from "@/features/onboarding/onboarding-schema";
import type { OnboardingActionResult } from "@/features/onboarding/onboarding-types";
import { createClient } from "@/lib/supabase/server";

export async function createBusiness(input: unknown): Promise<OnboardingActionResult> {
  const parsed = onboardingSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the business details and try again.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bootstrap_organization_v2", {
    organization_name: parsed.data.organizationName,
    store_name: parsed.data.storeName,
    register_name: parsed.data.registerName,
    currency_code: "PHP",
    timezone_name: "Asia/Manila",
    business_type: parsed.data.businessType,
  });

  if (error) {
    return {
      ok: false,
      message:
        error.code === "23505"
          ? "This account or business setup already exists. Refresh and try again."
          : "TINDIO could not create the business. Please try again.",
    };
  }

  const organizationId = data?.[0]?.organization_id;

  if (!organizationId) {
    return { ok: false, message: "TINDIO created no organization. Please try again." };
  }

  const cookieStore = await cookies();
  cookieStore.set("tindio-active-organization", organizationId, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return { ok: true, redirectTo: "/back-office" };
}
