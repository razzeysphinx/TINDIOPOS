import { z } from "zod";

export const POS_REFUND_PATH_PATTERN =
  "/api/pos/v2/receipts/:receiptId/refund" as const;
export const POS_REFUND_RPC = "refund_sale" as const;
export const POS_REFUND_PERMISSION = "sales.refund" as const;
export const POS_REFUND_PERMISSION_DATABASE_CODE = "42501" as const;
export const POS_REFUND_IDEMPOTENCY_DATABASE_CODE = "23505" as const;
export const POS_REFUND_CONSTRAINT_DATABASE_CODE = "23514" as const;
export const POS_REFUND_INCOMPLETE_DATABASE_CODE = "40001" as const;

export const POS_REFUND_REQUEST_INVALID_MESSAGE =
  "The request data is invalid." as const;
export const POS_REFUND_RECEIPT_INVALID_MESSAGE =
  "This receipt is invalid." as const;
export const POS_REFUND_RECEIPT_UNAVAILABLE_MESSAGE =
  "This receipt is unavailable." as const;
export const POS_REFUND_INPUT_MESSAGE =
  "Check the selected quantities, refund method, and reason before continuing." as const;
export const POS_REFUND_PERMISSION_MESSAGE =
  "You do not have permission to process refunds." as const;
export const POS_REFUND_DATABASE_PERMISSION_MESSAGE =
  "You do not have permission to process refunds for this sale." as const;
export const POS_REFUND_IDEMPOTENCY_MESSAGE =
  "This refund key belongs to a different request. Start a new refund." as const;
export const POS_REFUND_INCOMPLETE_MESSAGE =
  "The prior refund did not finish. Try again with a new refund." as const;
export const POS_REFUND_DATABASE_MESSAGE =
  "TINDIO could not process this refund. No payment record or stock change was made." as const;

const refundItemSchema = z.object({
  saleItemId: z.uuid(),
  quantity: z.number().int().min(1).max(10_000),
  returnToStock: z.boolean().optional().default(true),
});

export const posRefundReceiptIdSchema = z.uuid();

export const refundSaleSchema = z.object({
  saleId: z.uuid(),
  paymentMethodId: z.uuid(),
  idempotencyKey: z.uuid(),
  reason: z.string().trim().min(2).max(500),
  referenceNumber: z.string().trim().max(120),
  items: z.array(refundItemSchema).min(1).max(100),
  approvalRequestId: z.uuid().nullable().optional(),
});

export function posRefundPath(receiptId: string): string {
  return `/api/pos/v2/receipts/${receiptId}/refund`;
}

export type RefundSaleValues = z.infer<typeof refundSaleSchema>;

export type RefundSaleResult =
  | {
      ok: true;
      message: string;
      data: {
        refundId: string;
        refundNumber: number;
        totalMinor: number;
        wasReplayed: boolean;
      };
    }
  | { ok: false; message: string };

export type RefundDatabaseRow = {
  refund_id: string;
  refund_number: number;
  total_minor: number;
  was_replayed: boolean;
};
