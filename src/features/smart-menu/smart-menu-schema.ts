import { z } from "zod";

function uniqueUuidList(maximum: number) {
  return z
    .array(z.uuid())
    .max(maximum)
    .superRefine((values, context) => {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          message: "Each selection must appear only once.",
        });
      }
    });
}

export const saveSmartMenuConfigurationSchema = z.object({
  storeId: z.uuid(),
  isEnabled: z.boolean(),
  showPrices: z.boolean(),
  showImages: z.boolean(),
  showUnavailable: z.boolean(),
  showVariants: z.boolean(),
  showModifiers: z.boolean(),
  categoryIds: uniqueUuidList(250),
  productIds: uniqueUuidList(2_000),
});

export type SmartMenuConfigurationValues = z.infer<typeof saveSmartMenuConfigurationSchema>;
