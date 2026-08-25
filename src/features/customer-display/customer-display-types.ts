import { z } from "zod";

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

export type CustomerDisplayState = z.infer<typeof customerDisplayStateSchema>;

export type PosCustomerDisplaySession = {
  sessionId: string;
  registerId: string;
  realtimeTopic: string;
};

export type CustomerDisplayBootstrap = {
  businessName: string;
  storeName: string;
  registerName: string;
  realtimeTopic: string;
  initialState: CustomerDisplayState;
};

export type CustomerDisplayActionResult =
  | { ok: true; message: string; displayUrl: string }
  | { ok: false; message: string };

export function createIdleCustomerDisplayState(updatedAt = new Date().toISOString()): CustomerDisplayState {
  return {
    status: "idle",
    items: [],
    subtotalMinor: 0,
    discountMinor: 0,
    taxMinor: 0,
    totalMinor: 0,
    payments: [],
    customer: null,
    saleId: null,
    receiptNumber: null,
    changeMinor: 0,
    updatedAt,
  };
}
