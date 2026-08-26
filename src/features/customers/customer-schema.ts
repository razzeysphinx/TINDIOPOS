import { z } from "zod";

const optionalText = (maximum: number) =>
  z.string().trim().max(maximum);

const moneyAmount = z
  .string()
  .trim()
  .regex(/^\d{1,10}(?:\.\d{1,2})?$/, "Enter an amount with up to 2 decimal places.");

export const createCustomerSchema = z.object({
  fullName: z.string().trim().min(1, "Enter the customer's name.").max(160),
  email: optionalText(320).refine(
    (value) => !value || z.string().email().safeParse(value).success,
    "Enter a valid email address.",
  ),
  phone: optionalText(40),
  address: optionalText(500),
  birthday: z.string().trim().date().or(z.literal("")),
  notes: optionalText(1000),
  loyaltyCardCode: optionalText(80).refine(
    (value) => !value || value.length >= 3,
    "Enter at least 3 characters for the loyalty card.",
  ),
});

export const updateCustomerStatusSchema = z.object({
  customerId: z.uuid(),
  status: z.enum(["active", "archived"]),
});

export const updateLoyaltyProgramSchema = z.object({
  isEnabled: z.boolean(),
  earnSpend: moneyAmount,
  earnPoints: z.number().int().min(1).max(1_000_000),
  redemptionValue: moneyAmount,
  minimumRedemptionPoints: z.number().int().min(1).max(100_000_000),
});

export const createCustomerSegmentSchema = z.object({
  name: z.string().trim().min(1, "Enter a segment name.").max(80),
  description: optionalText(500).refine(
    (value) => !value || value.length >= 2,
    "Enter at least 2 characters for the description.",
  ),
});

export const updateCustomerSegmentSchema = createCustomerSegmentSchema.extend({
  segmentId: z.uuid(),
});

export const updateCustomerProfileSchema = createCustomerSchema.extend({
  customerId: z.uuid(),
  segmentIds: z.array(z.uuid()).max(20),
});

export const loyaltyAdjustmentSchema = z.object({
  customerId: z.uuid(),
  pointsDelta: z.number().int().min(-1_000_000).max(1_000_000).refine(
    (value) => value !== 0,
    "Enter a non-zero point adjustment.",
  ),
  reason: z.string().trim().min(2, "Enter a reason of at least 2 characters.").max(500),
});

export const importCustomersCsvSchema = z.object({
  rows: z.array(z.object({
    rowNumber: z.number().int().min(2),
    fullName: z.string().trim().min(1).max(160),
    email: optionalText(320),
    phone: optionalText(40),
    address: optionalText(500),
    birthday: z.string().trim().date().or(z.literal("")),
    notes: optionalText(1000),
    loyaltyCardCode: optionalText(80),
  })).min(1).max(500),
});

export type CreateCustomerValues = z.infer<typeof createCustomerSchema>;
export type CreateCustomerSegmentValues = z.infer<typeof createCustomerSegmentSchema>;
export type UpdateCustomerSegmentValues = z.infer<typeof updateCustomerSegmentSchema>;
export type UpdateCustomerProfileValues = z.infer<typeof updateCustomerProfileSchema>;
export type LoyaltyAdjustmentValues = z.infer<typeof loyaltyAdjustmentSchema>;
export type UpdateLoyaltyProgramValues = z.infer<typeof updateLoyaltyProgramSchema>;
