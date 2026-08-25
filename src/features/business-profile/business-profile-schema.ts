import { z } from "zod";

import { businessTypes } from "@/features/business-profile/business-features";

export const updateBusinessProfileSchema = z.object({
  businessType: z.enum(businessTypes),
  features: z.record(z.string(), z.boolean()),
});
