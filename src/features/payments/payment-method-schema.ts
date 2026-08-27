import { z } from "zod";

import { TINDIO_PAYMENT_PRESET_CODES } from "@/features/payments/payment-presets";

const paymentMethodCode = z
  .string()
  .trim()
  .min(2, "Use at least 2 characters.")
  .max(40, "Use at most 40 characters.")
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, "Use letters, numbers, or _.")
  .transform((value) => value.toUpperCase());

const paymentMethodType = z.enum([
  "CASH",
  "CARD",
  "E_WALLET",
  "BANK_TRANSFER",
  "VOUCHER",
  "OTHER",
]);

const offlinePolicy = z.enum(["disabled", "cash", "manual_external"]);

export const createPaymentMethodSchema = z.object({
  name: z.string().trim().min(1, "Enter a payment method name.").max(100),
  code: paymentMethodCode,
  paymentType: paymentMethodType,
  requiresReference: z.boolean(),
  storeIds: z.array(z.uuid()).min(1, "Enable the payment method for at least one store.").max(100),
});

export const updatePaymentMethodSchema = z.object({
  paymentMethodId: z.uuid(),
  name: z.string().trim().min(1, "Enter a payment method name.").max(100),
  isEnabled: z.boolean(),
  requiresReference: z.boolean(),
  sortOrder: z.number().int().min(0).max(100000),
});

export const setStorePaymentMethodAvailabilitySchema = z.object({
  paymentMethodId: z.uuid(),
  storeId: z.uuid(),
  isEnabled: z.boolean(),
});

export const setPaymentMethodOfflinePolicySchema = z.object({
  paymentMethodId: z.uuid(),
  offlinePolicy,
});

export const restoreTindioPaymentPresetSchema = z.object({
  presetCode: z.enum(TINDIO_PAYMENT_PRESET_CODES),
});
