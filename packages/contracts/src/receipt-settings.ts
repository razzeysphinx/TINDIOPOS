import { z } from "zod";

export const POS_RECEIPT_SETTINGS_RPC = "update_receipt_settings" as const;
export const POS_RECEIPT_SETTINGS_PERMISSION = "settings.manage" as const;
export const POS_RECEIPT_SETTINGS_PERMISSION_DATABASE_CODE = "42501" as const;
export const POS_RECEIPT_SETTINGS_CONSTRAINT_DATABASE_CODE = "23514" as const;

export const POS_RECEIPT_SETTINGS_PERMISSION_MESSAGE =
  "You do not have permission to update receipt settings." as const;
export const POS_RECEIPT_SETTINGS_INPUT_MESSAGE =
  "Check the receipt business information and layout values." as const;
export const POS_RECEIPT_SETTINGS_DATABASE_PERMISSION_MESSAGE =
  "You do not have permission to perform this receipt action." as const;
export const POS_RECEIPT_SETTINGS_DATABASE_MESSAGE =
  "TINDIO could not save the receipt settings." as const;
export const POS_RECEIPT_SETTINGS_SUCCESS_MESSAGE =
  "Receipt settings saved. New receipts will preserve this layout; existing receipts stay unchanged." as const;

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

export type ReceiptSettingsValues = z.infer<typeof receiptSettingsSchema>;

export type ReceiptSettingsResult =
  | { ok: true; message: string }
  | { ok: false; message: string };
