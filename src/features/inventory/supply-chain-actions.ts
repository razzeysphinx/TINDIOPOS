"use server";

import { revalidatePath } from "next/cache";

import {
  approveStockRequestSchema,
  createStockRequestSchema,
  createWarehouseSchema,
  dispatchStockRequestSchema,
  receiveStockRequestSchema,
  requestIdentifierSchema,
  updateSupplierLeadTimeSchema,
  upsertReplenishmentRuleSchema,
} from "@/features/inventory/supply-chain-schema";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";
import { postgresCodeMessage } from "@/lib/server/db-errors";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export type SupplyChainActionResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; message: string };

function validationError(): SupplyChainActionResult {
  return { ok: false, message: "Check the highlighted replenishment details and try again." };
}

const SUPPLY_CHAIN_DB_MESSAGES: Record<string, string> = {
  "23505": "This warehouse, rule, or document already exists.",
  "23503": "Choose records that belong to this organization.",
  "23514": "The replenishment details violate a stock or workflow rule.",
  "22023": "The replenishment details violate a stock or workflow rule.",
  "42501": "You do not have permission or a store assignment for this replenishment operation.",
};

function databaseMessage(code: string | undefined, fallback: string) {
  return postgresCodeMessage(code, fallback, SUPPLY_CHAIN_DB_MESSAGES);
}

async function requireSupplyChainManager() {
  const context = await requireBusinessContext();
  if (!context.features.inventory) return { context, error: "Inventory is disabled for this business." };
  if (!hasPermission(context, "inventory.manage")) {
    return { context, error: "You do not have permission to manage replenishment." };
  }
  return { context, error: null };
}

function refreshSupplyChain() {
  revalidatePath("/back-office/replenishment");
  revalidatePath("/back-office/inventory");
}

export async function createSupplyChainWarehouseAction(input: unknown): Promise<SupplyChainActionResult<{ warehouseId: string }>> {
  const { context, error: permissionError } = await requireSupplyChainManager();
  if (permissionError) return { ok: false, message: permissionError };
  const parsed = createWarehouseSchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_supply_chain_warehouse", {
    target_organization_id: context.organization.id,
    target_store_id: parsed.data.storeId,
    target_code: parsed.data.code,
    target_name: parsed.data.name,
    target_notes: parsed.data.notes,
  });
  if (error || !data) return { ok: false, message: databaseMessage(error?.code, "TINDIO could not create the warehouse location.") };
  refreshSupplyChain();
  return { ok: true, message: "Warehouse location created.", data: { warehouseId: data } };
}

export async function updateSupplierLeadTimeAction(input: unknown): Promise<SupplyChainActionResult> {
  const { context, error: permissionError } = await requireSupplyChainManager();
  if (permissionError) return { ok: false, message: permissionError };
  const parsed = updateSupplierLeadTimeSchema.safeParse(input);
  if (!parsed.success) return validationError();
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_supplier_lead_time", {
    target_organization_id: context.organization.id,
    target_supplier_id: parsed.data.supplierId,
    target_lead_time_days: Number(parsed.data.leadTimeDays),
  });
  if (error) return { ok: false, message: databaseMessage(error.code, "TINDIO could not update supplier lead time.") };
  refreshSupplyChain();
  return { ok: true, message: "Supplier lead time updated." };
}

export async function upsertReplenishmentRuleAction(input: unknown): Promise<SupplyChainActionResult<{ ruleId: string }>> {
  const { context, error: permissionError } = await requireSupplyChainManager();
  if (permissionError) return { ok: false, message: permissionError };
  const parsed = upsertReplenishmentRuleSchema.safeParse(input);
  if (!parsed.success) return validationError();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("upsert_inventory_replenishment_rule", {
    target_organization_id: context.organization.id,
    target_store_id: parsed.data.storeId,
    target_product_id: parsed.data.productId,
    target_variant_id: (parsed.data.variantId || null) as never,
    target_preferred_warehouse_id: (parsed.data.preferredWarehouseId || null) as never,
    target_reorder_point: Number(parsed.data.reorderPoint),
    target_target_stock: Number(parsed.data.targetStock),
  });
  if (error || !data) return { ok: false, message: databaseMessage(error?.code, "TINDIO could not save the reorder rule.") };
  refreshSupplyChain();
  return { ok: true, message: "Reorder point and target stock saved.", data: { ruleId: data } };
}

export async function createStockRequestAction(input: unknown): Promise<SupplyChainActionResult<{ stockRequestId: string }>> {
  const { context, error: permissionError } = await requireSupplyChainManager();
  if (permissionError) return { ok: false, message: permissionError };
  const parsed = createStockRequestSchema.safeParse(input);
  if (!parsed.success) return validationError();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_stock_request", {
    target_organization_id: context.organization.id,
    target_requesting_store_id: parsed.data.requestingStoreId,
    target_source_warehouse_id: parsed.data.sourceWarehouseId,
    target_note: parsed.data.note,
    target_operation_id: parsed.data.operationId,
    target_lines: parsed.data.lines.map((line) => ({
      product_id: line.productId,
      variant_id: line.variantId || null,
      quantity: line.quantity,
    })) as Json,
  });
  if (error || !data) return { ok: false, message: databaseMessage(error?.code, "TINDIO could not submit the stock request.") };
  refreshSupplyChain();
  return { ok: true, message: "Stock request submitted for warehouse approval.", data: { stockRequestId: data } };
}

export async function approveStockRequestAction(input: unknown): Promise<SupplyChainActionResult> {
  const { context, error: permissionError } = await requireSupplyChainManager();
  if (permissionError) return { ok: false, message: permissionError };
  const parsed = approveStockRequestSchema.safeParse(input);
  if (!parsed.success) return validationError();
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_stock_request", {
    target_organization_id: context.organization.id,
    target_stock_request_id: parsed.data.stockRequestId,
    target_lines: parsed.data.lines.map((line) => ({
      stock_request_line_id: line.stockRequestLineId,
      approved_quantity: line.approvedQuantity,
    })) as Json,
  });
  if (error) return { ok: false, message: databaseMessage(error.code, "TINDIO could not approve this request.") };
  refreshSupplyChain();
  return { ok: true, message: "Stock request approved and ready to pick." };
}

export async function startStockRequestPickingAction(input: unknown): Promise<SupplyChainActionResult> {
  const { context, error: permissionError } = await requireSupplyChainManager();
  if (permissionError) return { ok: false, message: permissionError };
  const parsed = requestIdentifierSchema.safeParse(input);
  if (!parsed.success) return validationError();
  const supabase = await createClient();
  const { error } = await supabase.rpc("start_stock_request_picking", {
    target_organization_id: context.organization.id,
    target_stock_request_id: parsed.data.stockRequestId,
  });
  if (error) return { ok: false, message: databaseMessage(error.code, "TINDIO could not start picking this request.") };
  refreshSupplyChain();
  return { ok: true, message: "Picking started. Stock is still in the warehouse." };
}

export async function dispatchStockRequestAction(input: unknown): Promise<SupplyChainActionResult<{ stockTransferId: string }>> {
  const { context, error: permissionError } = await requireSupplyChainManager();
  if (permissionError) return { ok: false, message: permissionError };
  const parsed = dispatchStockRequestSchema.safeParse(input);
  if (!parsed.success) return validationError();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dispatch_stock_request", {
    target_organization_id: context.organization.id,
    target_stock_request_id: parsed.data.stockRequestId,
    target_note: parsed.data.note,
    target_operation_id: parsed.data.operationId,
  });
  if (error || !data) return { ok: false, message: databaseMessage(error?.code, "TINDIO could not dispatch this request.") };
  refreshSupplyChain();
  return { ok: true, message: "Request dispatched. It is now in transit.", data: { stockTransferId: data } };
}

export async function receiveStockRequestAction(input: unknown): Promise<SupplyChainActionResult<{ stockRequestId: string }>> {
  const { context, error: permissionError } = await requireSupplyChainManager();
  if (permissionError) return { ok: false, message: permissionError };
  const parsed = receiveStockRequestSchema.safeParse(input);
  if (!parsed.success) return validationError();
  const supabase = await createClient();
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
  if (error || !data) return { ok: false, message: databaseMessage(error?.code, "TINDIO could not record this receipt.") };
  refreshSupplyChain();
  return { ok: true, message: "Receipt recorded. Only the received quantity was added to stock.", data: { stockRequestId: data } };
}
