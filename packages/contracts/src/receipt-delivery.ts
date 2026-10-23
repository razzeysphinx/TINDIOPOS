import { z } from "zod";

export const POS_RECEIPT_DELIVERY_PATH_PATTERN =
  /^\/api\/pos\/v2\/receipts\/[^/]+\/delivery\/?$/;
export const POS_RECEIPT_DELIVERY_RPC = "queue_receipt_delivery" as const;
export const POS_RECEIPT_DELIVERY_PERMISSION = "receipts.reprint" as const;
export const POS_RECEIPT_DELIVERY_CHANNEL = "EMAIL" as const;
export const POS_RECEIPT_DELIVERY_PERMISSION_DATABASE_CODE = "42501" as const;
export const POS_RECEIPT_DELIVERY_IDEMPOTENCY_DATABASE_CODE = "23505" as const;
export const POS_RECEIPT_DELIVERY_CONSTRAINT_DATABASE_CODE = "23514" as const;

export const POS_RECEIPT_DELIVERY_PERMISSION_MESSAGE =
  "You do not have permission to queue a digital receipt." as const;
export const POS_RECEIPT_DELIVERY_INPUT_MESSAGE =
  "Enter a valid recipient email address." as const;
export const POS_RECEIPT_DELIVERY_REQUEST_INVALID_MESSAGE =
  "The request data is invalid." as const;
export const POS_RECEIPT_DELIVERY_RECEIPT_INVALID_MESSAGE =
  "This receipt is invalid." as const;
export const POS_RECEIPT_DELIVERY_DATABASE_PERMISSION_MESSAGE =
  "You do not have permission to perform this receipt action." as const;
export const POS_RECEIPT_DELIVERY_IDEMPOTENCY_MESSAGE =
  "This action was already recorded for a different request." as const;
export const POS_RECEIPT_DELIVERY_DATABASE_MESSAGE =
  "TINDIO could not queue this digital receipt." as const;
export const POS_RECEIPT_DELIVERY_QUEUED_MESSAGE =
  "Digital receipt request queued securely." as const;
export const POS_RECEIPT_DELIVERY_REPLAYED_MESSAGE =
  "This digital receipt request was already queued." as const;

export const receiptDeliveryRecipientSchema = z.string().trim().email().max(320);

export const receiptDeliverySchema = z.object({
  receiptId: z.uuid(),
  recipient: receiptDeliveryRecipientSchema,
  idempotencyKey: z.uuid(),
});

export type ReceiptDeliveryValues = z.infer<typeof receiptDeliverySchema>;

export type ReceiptDeliveryDatabaseRow = {
  delivery_request_id: string;
  delivery_status: string;
  was_replayed: boolean;
};

export type ReceiptDeliveryResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export function posReceiptDeliveryPath(receiptId: string): string {
  return `/api/pos/v2/receipts/${receiptId}/delivery`;
}

export function receiptDeliverySuccessMessage(row: ReceiptDeliveryDatabaseRow): string {
  return row.was_replayed
    ? POS_RECEIPT_DELIVERY_REPLAYED_MESSAGE
    : POS_RECEIPT_DELIVERY_QUEUED_MESSAGE;
}
