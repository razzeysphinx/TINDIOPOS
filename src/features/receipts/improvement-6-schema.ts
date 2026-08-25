import { z } from "zod";

const optionalText = (maximum: number) => z.string().trim().max(maximum);

export const receiptSettingsSchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  businessAddress: optionalText(500),
  businessPhone: optionalText(40),
  businessEmail: optionalText(320).refine(
    (value) => value === "" || z.email().safeParse(value).success,
    "Enter a valid business email address.",
  ),
  businessTaxId: optionalText(80),
  businessWebsite: optionalText(2048),
  headerMessage: optionalText(160),
  footerMessage: z.string().trim().min(2).max(240),
  paperWidthMm: z.union([z.literal(58), z.literal(80)]),
  showStoreAddress: z.boolean(),
  showStorePhone: z.boolean(),
  showCashier: z.boolean(),
  showRegister: z.boolean(),
  showPaymentDetails: z.boolean(),
});

export const receiptDeliverySchema = z.object({
  receiptId: z.uuid(),
  recipient: z.string().trim().email().max(320),
  idempotencyKey: z.uuid(),
});

export const saleExchangeSchema = z.object({
  refundId: z.uuid(),
  replacementReceiptNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  idempotencyKey: z.uuid(),
});

export type ReceiptSettingsValues = z.infer<typeof receiptSettingsSchema>;
