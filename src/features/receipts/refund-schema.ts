import { z } from "zod";

const refundItemSchema = z.object({
  saleItemId: z.uuid(),
  quantity: z.number().int().min(1).max(10000),
});

export const refundSaleSchema = z.object({
  saleId: z.uuid(),
  paymentMethodId: z.uuid(),
  idempotencyKey: z.uuid(),
  reason: z.string().trim().min(2).max(500),
  referenceNumber: z.string().trim().max(120),
  items: z.array(refundItemSchema).min(1).max(100),
  approvalRequestId: z.uuid().nullable().optional(),
});

export type RefundSaleValues = z.infer<typeof refundSaleSchema>;
