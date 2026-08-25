"use server";

import { revalidatePath } from "next/cache";

import { createBusiness } from "@/features/onboarding/service";
import type { OnboardingActionResult } from "@/features/onboarding/onboarding-types";
import { requireUser } from "@/lib/auth/dal";

export async function createBusinessAction(
  input: unknown,
): Promise<OnboardingActionResult> {
  await requireUser();

  const result = await createBusiness(input);

  if (result.ok) {
    revalidatePath("/back-office", "layout");
  }

  return result;
}
