import { z } from "zod";

export const POS_STOCK_REQUEST_RECEIPT_PATH_PATTERN =
  /^\/api\/pos\/v2\/stock-requests\/([^/]+)\/receive\/?$/;
export const POS_STOCK_REQUEST_RECEIPT_RPC = "receive_stock_request" as const;
export const POS_STOCK_REQUEST_RECEIPT_PERMISSION = "inventory.transfer.receive" as const;

export const POS_STOCK_REQUEST_RECEIPT_ID_INVALID_MESSAGE =
  "This stock request is invalid." as const;
export const POS_STOCK_REQUEST_RECEIPT_INVENTORY_DISABLED_MESSAGE =
  "Inventory is disabled for this business." as const;
export const POS_STOCK_REQUEST_RECEIPT_PERMISSION_MESSAGE =
  "You do not have permission to receive stock transfers." as const;
export const POS_STOCK_REQUEST_RECEIPT_INPUT_MESSAGE =
  "Check the highlighted replenishment details and try again." as const;
export const POS_STOCK_REQUEST_RECEIPT_DATABASE_MESSAGE =
  "TINDIO could not record this receipt." as const;
export const POS_STOCK_REQUEST_RECEIPT_SUCCESS_MESSAGE =
  "Receipt recorded. Only the received quantity was added to stock." as const;

const receiptQuantitySchema = z
  .string()
  .trim()
  .regex(/^\d{1,8}(?:\.\d{1,3})?$/, "Use a non-negative quantity with up to 3 decimals.");

export const posStockRequestReceiptIdSchema = z.uuid();

export const receiveStockRequestSchema = z
  .object({
    operationId: z.uuid("Start the operation again and retry."),
    stockRequestId: z.uuid("Choose a valid record."),
    note: z.string().trim().max(500),
    lines: z
      .array(z.object({
        stockTransferLineId: z.uuid("Choose a valid record."),
        receivedQuantity: receiptQuantitySchema,
        shortQuantity: receiptQuantitySchema,
        discrepancyNote: z.string().trim().max(500),
      }))
      .min(1)
      .max(100),
  })
  .superRefine((value, context) => {
    if (new Set(value.lines.map((line) => line.stockTransferLineId)).size !== value.lines.length) {
      context.addIssue({ code: "custom", path: ["lines"], message: "Each transfer line can be received once per submission." });
    }

    for (const [index, line] of value.lines.entries()) {
      if (Number(line.receivedQuantity) + Number(line.shortQuantity) <= 0) {
        context.addIssue({ code: "custom", path: ["lines", index], message: "Enter a received or short quantity." });
      }
      if (Number(line.shortQuantity) > 0 && line.discrepancyNote.length < 2) {
        context.addIssue({ code: "custom", path: ["lines", index, "discrepancyNote"], message: "Explain the shortage or discrepancy." });
      }
    }
  });

export type ReceiveStockRequestValues = z.infer<typeof receiveStockRequestSchema>;

export type StockRequestReceiptResult =
  | { ok: true; message: string; data?: { stockRequestId: string } }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };
