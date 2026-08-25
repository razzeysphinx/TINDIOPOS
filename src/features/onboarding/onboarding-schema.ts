import { z } from "zod";

import { businessTypes } from "@/features/business-profile/business-features";

export const onboardingSchema = z.object({
  organizationName: z
    .string()
    .trim()
    .min(2, "Enter your business name.")
    .max(160, "Business name is too long."),
  businessType: z.enum(businessTypes),
  storeName: z
    .string()
    .trim()
    .min(2, "Enter your first store name.")
    .max(160, "Store name is too long."),
  registerName: z
    .string()
    .trim()
    .min(2, "Enter your first register name.")
    .max(160, "Register name is too long."),
});

export type OnboardingValues = z.infer<typeof onboardingSchema>;
