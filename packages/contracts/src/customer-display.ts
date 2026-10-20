import { z } from "zod";

export const CUSTOMER_DISPLAY_UPDATE_PATH = "/api/pos/v2/customer-display" as const;
export const CUSTOMER_DISPLAY_UPDATE_RPC = "set_customer_display_state" as const;
export const CUSTOMER_DISPLAY_UPDATE_PERMISSIONS = ["pos.access", "sales.create"] as const;
export const CUSTOMER_DISPLAY_PERMISSION_ERROR = "POS access is not permitted." as const;
export const CUSTOMER_DISPLAY_INVALID_ERROR =
  "The customer display update is invalid." as const;
export const CUSTOMER_DISPLAY_OPEN_SHIFT_ERROR =
  "An open shift is required for this display." as const;
export const CUSTOMER_DISPLAY_UPDATE_ERROR = "The display could not be updated." as const;
export const CUSTOMER_DISPLAY_OPEN_SHIFT_DATABASE_CODE = "42501" as const;

export type PosCustomerDisplaySession = {
  sessionId: string;
  registerId: string;
  realtimeTopic: string;
};

const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);

export const customerDisplayStateSchema = z.object({
  status: z.enum(["idle", "cart", "payment", "complete"]),
  currencyCode: currencyCodeSchema.optional(),
  items: z.array(
    z.object({
      name: z.string().min(1).max(160),
      variantName: z.string().max(160).nullable(),
      modifiers: z.array(z.string().min(1).max(100)).max(50),
      quantity: z.number().int().min(1).max(10_000),
      lineTotalMinor: z.number().int().min(0).max(1_000_000_000_000),
    }),
  ).max(100),
  subtotalMinor: z.number().int().min(0).max(1_000_000_000_000),
  discountMinor: z.number().int().min(0).max(1_000_000_000_000),
  taxMinor: z.number().int().min(0).max(1_000_000_000_000),
  totalMinor: z.number().int().min(0).max(1_000_000_000_000),
  payments: z.array(
    z.object({
      name: z.string().min(1).max(100),
      amountMinor: z.number().int().min(0).max(1_000_000_000_000),
      tenderedMinor: z.number().int().min(0).max(1_000_000_000_000).nullable(),
      changeMinor: z.number().int().min(0).max(1_000_000_000_000).nullable(),
    }),
  ).max(10).default([]),
  customer: z.object({
    name: z.string().min(1).max(160),
    loyaltyPoints: z.number().int().min(0).max(100_000_000),
  }).nullable(),
  saleId: z.uuid().nullable().default(null),
  receiptNumber: z.number().int().positive().nullable(),
  changeMinor: z.number().int().min(0).max(1_000_000_000_000),
  updatedAt: z.string().datetime(),
});

export const customerDisplayUpdateSchema = z.object({
  sessionId: z.uuid(),
  state: customerDisplayStateSchema,
});

export type CustomerDisplayState = z.infer<typeof customerDisplayStateSchema>;
export type CustomerDisplayUpdate = z.infer<typeof customerDisplayUpdateSchema>;
