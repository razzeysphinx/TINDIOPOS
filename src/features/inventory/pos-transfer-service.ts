import "server-only";

import {
  POS_TRANSFER_RECEIPT_DATABASE_MESSAGE,
  POS_TRANSFER_RECEIPT_INVENTORY_DISABLED_MESSAGE,
  POS_TRANSFER_RECEIPT_PERMISSION_MESSAGE,
  POS_TRANSFER_RECEIPT_RPC,
  POS_TRANSFER_RECEIPT_SUCCESS_MESSAGE,
  POS_TRANSFER_RECEIPT_TRANSFERS_DISABLED_MESSAGE,
  receiveStockTransferSchema,
  type TransferReceiptResult,
} from "@tindio/contracts/transfer-receipt";
import {
  POS_STOCK_REQUEST_RECEIPT_DATABASE_MESSAGE,
  POS_STOCK_REQUEST_RECEIPT_INPUT_MESSAGE,
  POS_STOCK_REQUEST_RECEIPT_INVENTORY_DISABLED_MESSAGE,
  POS_STOCK_REQUEST_RECEIPT_PERMISSION,
  POS_STOCK_REQUEST_RECEIPT_PERMISSION_MESSAGE,
  POS_STOCK_REQUEST_RECEIPT_RPC,
  POS_STOCK_REQUEST_RECEIPT_SUCCESS_MESSAGE,
  type StockRequestReceiptResult,
} from "@tindio/contracts/stock-request-receipt";
import { hasAllInventoryCapabilities } from "@/features/inventory/inventory-permissions";
import { receiveStockRequestSchema } from "@/features/inventory/supply-chain-schema";
import type { BusinessContext } from "@/lib/auth/dal";
import { postgresCodeMessage, validationFailure } from "@/lib/server/db-errors";
import type { Json } from "@/lib/supabase/database.types";
import { createBusinessContextClient } from "@/lib/supabase/context-client";

export type PosTransferResult<T> =
  | { ok: true; message: string; data?: T }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

const DIRECT_TRANSFER_DB_MESSAGES: Record<string, string> = {
  "23505": "This supplier or inventory document already exists.",
  "23503": "Choose records that belong to this organization.",
  "23514": "The inventory details violate a business rule. Check available stock and quantities.",
  "22023": "The inventory details violate a business rule. Check available stock and quantities.",
  "42501": "You do not have permission to make this inventory change.",
};

const REQUEST_TRANSFER_DB_MESSAGES: Record<string, string> = {
  "23505": "This warehouse, rule, or document already exists.",
  "23503": "Choose records that belong to this organization.",
  "23514": "The replenishment details violate a stock or workflow rule.",
  "22023": "The replenishment details violate a stock or workflow rule.",
  "42501": "You do not have permission or a store assignment for this replenishment operation.",
};

function directTransferDatabaseMessage(code: string | undefined, fallback: string) {
  return postgresCodeMessage(code, fallback, DIRECT_TRANSFER_DB_MESSAGES);
}

function requestTransferDatabaseMessage(code: string | undefined, fallback: string) {
  return postgresCodeMessage(code, fallback, REQUEST_TRANSFER_DB_MESSAGES);
}

function canReceive(context: BusinessContext) {
  return context.features.inventory
    && hasAllInventoryCapabilities(context, [POS_STOCK_REQUEST_RECEIPT_PERMISSION]);
}

export async function receivePosStockTransfer({ context, input }: { context: BusinessContext; input: unknown }): Promise<TransferReceiptResult> {
  if (!context.features.inventory) return { ok: false, message: POS_TRANSFER_RECEIPT_INVENTORY_DISABLED_MESSAGE };
  if (!hasAllInventoryCapabilities(context, ["inventory.transfer.receive"])) {
    return { ok: false, message: POS_TRANSFER_RECEIPT_PERMISSION_MESSAGE };
  }
  if (!context.features.transfers) return { ok: false, message: POS_TRANSFER_RECEIPT_TRANSFERS_DISABLED_MESSAGE };
  const parsed = receiveStockTransferSchema.safeParse(input);
  if (!parsed.success) return validationFailure();

  const supabase = await createBusinessContextClient(context);
  const { data, error } = await supabase.rpc(POS_TRANSFER_RECEIPT_RPC, {
    target_organization_id: context.organization.id,
    target_stock_transfer_id: parsed.data.stockTransferId,
    target_note: parsed.data.note,
    target_operation_id: parsed.data.operationId,
    target_lines: parsed.data.lines.map((line) => ({
      stock_transfer_line_id: line.stockTransferLineId,
      received_quantity: line.receivedQuantity,
      short_quantity: line.shortQuantity,
      discrepancy_note: line.discrepancyNote || null,
    })) as Json,
  });
  if (error || !data) return { ok: false, message: directTransferDatabaseMessage(error?.code, POS_TRANSFER_RECEIPT_DATABASE_MESSAGE) };
  return { ok: true, message: POS_TRANSFER_RECEIPT_SUCCESS_MESSAGE, data: { receiptId: data } };
}

export async function receivePosStockRequest({ context, input }: { context: BusinessContext; input: unknown }): Promise<StockRequestReceiptResult> {
  if (!canReceive(context)) {
    return { ok: false, message: context.features.inventory ? POS_STOCK_REQUEST_RECEIPT_PERMISSION_MESSAGE : POS_STOCK_REQUEST_RECEIPT_INVENTORY_DISABLED_MESSAGE };
  }
  const parsed = receiveStockRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: POS_STOCK_REQUEST_RECEIPT_INPUT_MESSAGE };
  const supabase = await createBusinessContextClient(context);
  const { data, error } = await supabase.rpc(POS_STOCK_REQUEST_RECEIPT_RPC, {
    target_organization_id: context.organization.id,
    target_stock_request_id: parsed.data.stockRequestId,
    target_note: parsed.data.note,
    target_operation_id: parsed.data.operationId,
    target_lines: parsed.data.lines.map((line) => ({
      stock_transfer_line_id: line.stockTransferLineId,
      received_quantity: line.receivedQuantity,
      short_quantity: line.shortQuantity,
      discrepancy_note: line.discrepancyNote,
    })) as Json,
  });
  if (error || !data) return { ok: false, message: requestTransferDatabaseMessage(error?.code, POS_STOCK_REQUEST_RECEIPT_DATABASE_MESSAGE) };
  return { ok: true, message: POS_STOCK_REQUEST_RECEIPT_SUCCESS_MESSAGE, data: { stockRequestId: data } };
}
