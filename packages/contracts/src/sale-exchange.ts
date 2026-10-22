import { z } from "zod";

export const POS_SALE_EXCHANGE_RPC = "link_sale_exchange" as const;
export const POS_SALE_EXCHANGE_PERMISSIONS = ["sales.refund", "sales.create"] as const;
export const POS_SALE_EXCHANGE_PERMISSION_DATABASE_CODE = "42501" as const;
export const POS_SALE_EXCHANGE_IDEMPOTENCY_DATABASE_CODE = "23505" as const;
export const POS_SALE_EXCHANGE_CONSTRAINT_DATABASE_CODE = "23514" as const;
export const POS_SALE_EXCHANGE_NOT_FOUND_DATABASE_CODE = "P0002" as const;

export const POS_SALE_EXCHANGE_PERMISSION_MESSAGE =
  "Sales and refund permission are required to record an exchange." as const;
export const POS_SALE_EXCHANGE_INPUT_MESSAGE =
  "Choose a completed return and enter a valid replacement receipt number." as const;
export const POS_SALE_EXCHANGE_DATABASE_PERMISSION_MESSAGE =
  "You do not have permission to perform this receipt action." as const;
export const POS_SALE_EXCHANGE_IDEMPOTENCY_MESSAGE =
  "This action was already recorded for a different request." as const;
export const POS_SALE_EXCHANGE_DATABASE_MESSAGE =
  "TINDIO could not link this return and replacement sale." as const;

export const saleExchangeSchema = z.object({
  refundId: z.uuid(),
  replacementReceiptNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  idempotencyKey: z.uuid(),
});

export type SaleExchangeValues = z.infer<typeof saleExchangeSchema>;

export type SaleExchangeDatabaseRow = {
  exchange_id: string;
  replacement_sale_id: string;
  replacement_receipt_number: number;
  was_replayed: boolean;
};

export type SaleExchangeResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export function saleExchangeSuccessMessage(row: SaleExchangeDatabaseRow): string {
  return row.was_replayed
    ? `This exchange is already linked to receipt #${row.replacement_receipt_number}.`
    : `Exchange recorded: return linked to replacement receipt #${row.replacement_receipt_number}.`;
}
