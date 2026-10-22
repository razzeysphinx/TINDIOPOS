import { z } from "zod";

export const POS_TRANSFER_RECEIPT_PATH_PATTERN =
  "/api/pos/v2/transfers/:transferId/receive" as const;
export const POS_TRANSFER_RECEIPT_RPC = "receive_stock_transfer" as const;
export const POS_TRANSFER_RECEIPT_PERMISSION = "inventory.transfer.receive" as const;

export const POS_TRANSFER_RECEIPT_REQUEST_INVALID_MESSAGE =
  "The request data is invalid." as const;
export const POS_TRANSFER_RECEIPT_ID_INVALID_MESSAGE =
  "This transfer is invalid." as const;
export const POS_TRANSFER_RECEIPT_INPUT_MESSAGE =
  "Check the highlighted details and try again." as const;
export const POS_TRANSFER_RECEIPT_INVENTORY_DISABLED_MESSAGE =
  "Inventory is disabled for this business." as const;
export const POS_TRANSFER_RECEIPT_PERMISSION_MESSAGE =
  "You do not have permission to receive stock transfers." as const;
export const POS_TRANSFER_RECEIPT_TRANSFERS_DISABLED_MESSAGE =
  "Stock transfers are disabled for this business." as const;
export const POS_TRANSFER_RECEIPT_DATABASE_MESSAGE =
  "TINDIO could not receive this transfer." as const;
export const POS_TRANSFER_RECEIPT_SUCCESS_MESSAGE =
  "Transfer receipt posted and destination stock updated." as const;

const receiptQuantitySchema = z
  .string()
  .trim()
  .regex(/^\d{1,8}(?:\.\d{1,3})?$/, "Use a non-negative quantity with up to 3 decimals.");

export const posTransferReceiptIdSchema = z.uuid();

export const receiveStockTransferSchema = z
  .object({
    operationId: z.uuid("Start the operation again and retry."),
    stockTransferId: z.uuid("Select a transfer."),
    note: z.string().trim().max(500),
    lines: z
      .array(z.object({
        stockTransferLineId: z.uuid(),
        receivedQuantity: receiptQuantitySchema,
        shortQuantity: receiptQuantitySchema,
        discrepancyNote: z.string().trim().max(500),
      }))
      .min(1, "Enter at least one received quantity.")
      .max(100),
  })
  .superRefine((value, context) => {
    if (new Set(value.lines.map((line) => line.stockTransferLineId)).size !== value.lines.length) {
      context.addIssue({ code: "custom", path: ["lines"], message: "Each transfer line can be received once per receipt." });
    }
    for (const [index, line] of value.lines.entries()) {
      if (Number(line.receivedQuantity) + Number(line.shortQuantity) <= 0) {
        context.addIssue({ code: "custom", path: ["lines", index], message: "Enter a received or short quantity." });
      }
      if (Number(line.shortQuantity) > 0 && line.discrepancyNote.length < 2) {
        context.addIssue({ code: "custom", path: ["lines", index, "discrepancyNote"], message: "Explain the shortage or damage." });
      }
    }
  });

export function posTransferReceiptPath(transferId: string): string {
  return `/api/pos/v2/transfers/${transferId}/receive`;
}

export type ReceiveStockTransferValues = z.infer<typeof receiveStockTransferSchema>;

export type TransferReceiptResult =
  | { ok: true; message: string; data?: { receiptId: string } }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };
