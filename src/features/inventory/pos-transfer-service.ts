import "server-only";

import { receiveStockTransferSchema } from "@/features/inventory/advanced-inventory-schema";
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
    && hasAllInventoryCapabilities(context, ["inventory.transfer.receive"]);
}

export async function receivePosStockTransfer({ context, input }: { context: BusinessContext; input: unknown }): Promise<PosTransferResult<{ receiptId: string }>> {
  if (!context.features.inventory) return { ok: false, message: "Inventory is disabled for this business." };
  if (!hasAllInventoryCapabilities(context, ["inventory.transfer.receive"])) {
    return { ok: false, message: "You do not have permission to receive stock transfers." };
  }
  if (!context.features.transfers) return { ok: false, message: "Stock transfers are disabled for this business." };
  const parsed = receiveStockTransferSchema.safeParse(input);
  if (!parsed.success) return validationFailure();

  const supabase = await createBusinessContextClient(context);
  const { data, error } = await supabase.rpc("receive_stock_transfer", {
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
  if (error || !data) return { ok: false, message: directTransferDatabaseMessage(error?.code, "TINDIO could not receive this transfer.") };
  return { ok: true, message: "Transfer receipt posted and destination stock updated.", data: { receiptId: data } };
}

export async function receivePosStockRequest({ context, input }: { context: BusinessContext; input: unknown }): Promise<PosTransferResult<{ stockRequestId: string }>> {
  if (!canReceive(context)) {
    return { ok: false, message: context.features.inventory ? "You do not have permission to receive stock transfers." : "Inventory is disabled for this business." };
  }
  const parsed = receiveStockRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the highlighted replenishment details and try again." };
  const supabase = await createBusinessContextClient(context);
  const { data, error } = await supabase.rpc("receive_stock_request", {
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
  if (error || !data) return { ok: false, message: requestTransferDatabaseMessage(error?.code, "TINDIO could not record this receipt.") };
  return { ok: true, message: "Receipt recorded. Only the received quantity was added to stock.", data: { stockRequestId: data } };
}
