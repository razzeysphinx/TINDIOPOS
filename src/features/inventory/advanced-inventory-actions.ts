"use server";

import { revalidatePath } from "next/cache";

import { moneyInputToMinor } from "@/features/catalog/catalog-money";
import {
  completeInventoryCountSchema,
  createAdjustmentReasonSchema,
  createPurchaseOrderSchema,
  createSupplierSchema,
  produceCompositeSchema,
  receiveStockTransferSchema,
  receivePurchaseOrderSchema,
  recordInventoryAdjustmentSchema,
  returnToSupplierSchema,
  transferStockSchema,
  updateInventoryPolicySchema,
} from "@/features/inventory/advanced-inventory-schema";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export type AdvancedInventoryActionResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function validationError(): AdvancedInventoryActionResult {
  return { ok: false, message: "Check the highlighted details and try again." };
}

function databaseMessage(code: string | undefined, fallback: string) {
  if (code === "23505") return "This supplier or inventory document already exists.";
  if (code === "23503") return "Choose records that belong to this organization.";
  if (code === "23514" || code === "22023") {
    return "The inventory details violate a business rule. Check available stock and quantities.";
  }
  if (code === "42501") return "You do not have permission to make this inventory change.";
  return fallback;
}

async function requireInventoryManager() {
  const context = await requireBusinessContext();

  if (!context.features.inventory) {
    return { context, error: "Inventory is disabled for this business." };
  }

  if (!hasPermission(context, "inventory.manage")) {
    return { context, error: "You do not have permission to manage inventory." };
  }

  return { context, error: null };
}

export async function createSupplierAction(
  input: unknown,
): Promise<AdvancedInventoryActionResult<{ supplierId: string }>> {
  const { context, error: permissionError } = await requireInventoryManager();
  if (permissionError) return { ok: false, message: permissionError };
  if (!context.features.purchase_orders) return { ok: false, message: "Purchase orders are disabled for this business." };

  const parsed = createSupplierSchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_supplier", {
    target_organization_id: context.organization.id,
    target_name: parsed.data.name,
    target_contact_name: parsed.data.contactName,
    target_email: parsed.data.email,
    target_phone: parsed.data.phone,
    target_address: parsed.data.address,
    target_notes: parsed.data.notes,
  });

  if (error || !data) {
    return { ok: false, message: databaseMessage(error?.code, "TINDIO could not create the supplier.") };
  }

  revalidatePath("/back-office/inventory");
  return { ok: true, message: "Supplier created.", data: { supplierId: data } };
}

export async function createPurchaseOrderAction(
  input: unknown,
): Promise<AdvancedInventoryActionResult<{ purchaseOrderId: string }>> {
  const { context, error: permissionError } = await requireInventoryManager();
  if (permissionError) return { ok: false, message: permissionError };
  if (!context.features.purchase_orders) return { ok: false, message: "Purchase orders are disabled for this business." };

  if (!hasPermission(context, "products.view_cost")) {
    return { ok: false, message: "You do not have permission to record purchase costs." };
  }

  const parsed = createPurchaseOrderSchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_purchase_order", {
    target_organization_id: context.organization.id,
    target_store_id: parsed.data.storeId,
    target_supplier_id: parsed.data.supplierId,
    target_notes: parsed.data.notes,
    target_expected_at: (parsed.data.expectedAt || null) as never,
    target_lines: parsed.data.lines.map((line) => ({
      product_id: line.productId,
      variant_id: line.variantId || null,
      quantity: line.quantity,
      unit_cost_minor: moneyInputToMinor(line.unitCost),
    })) as Json,
  });

  if (error || !data) {
    return {
      ok: false,
      message: databaseMessage(error?.code, "TINDIO could not create the purchase order."),
    };
  }

  revalidatePath("/back-office/inventory");
  return { ok: true, message: "Purchase order created.", data: { purchaseOrderId: data } };
}

export async function receivePurchaseOrderAction(
  input: unknown,
): Promise<AdvancedInventoryActionResult<{ receiptId: string }>> {
  const { context, error: permissionError } = await requireInventoryManager();
  if (permissionError) return { ok: false, message: permissionError };
  if (!context.features.purchase_orders) return { ok: false, message: "Purchase orders are disabled for this business." };

  const parsed = receivePurchaseOrderSchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("receive_purchase_order", {
    target_organization_id: context.organization.id,
    target_purchase_order_id: parsed.data.purchaseOrderId,
    target_note: parsed.data.note,
    target_lines: parsed.data.lines.map((line) => ({
      purchase_order_line_id: line.purchaseOrderLineId,
      quantity: line.quantity,
    })) as Json,
  });

  if (error || !data) {
    return { ok: false, message: databaseMessage(error?.code, "TINDIO could not receive this order.") };
  }

  revalidatePath("/back-office/inventory");
  return { ok: true, message: "Goods received and stock updated.", data: { receiptId: data } };
}

export async function completeInventoryCountAction(
  input: unknown,
): Promise<AdvancedInventoryActionResult<{ inventoryCountId: string }>> {
  const { context, error: permissionError } = await requireInventoryManager();
  if (permissionError) return { ok: false, message: permissionError };

  const parsed = completeInventoryCountSchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("complete_inventory_count", {
    target_organization_id: context.organization.id,
    target_store_id: parsed.data.storeId,
    target_note: parsed.data.note,
    target_lines: parsed.data.lines.map((line) => ({
      product_id: line.productId,
      variant_id: line.variantId || null,
      counted_quantity: line.countedQuantity,
    })) as Json,
  });

  if (error || !data) {
    return { ok: false, message: databaseMessage(error?.code, "TINDIO could not complete the count.") };
  }

  revalidatePath("/back-office/inventory");
  return { ok: true, message: "Inventory count completed and variances posted.", data: { inventoryCountId: data } };
}

export async function transferStockAction(
  input: unknown,
): Promise<AdvancedInventoryActionResult<{ transferId: string }>> {
  const { context, error: permissionError } = await requireInventoryManager();
  if (permissionError) return { ok: false, message: permissionError };
  if (!context.features.transfers) return { ok: false, message: "Stock transfers are disabled for this business." };

  const parsed = transferStockSchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ship_stock_transfer", {
    target_organization_id: context.organization.id,
    target_source_store_id: parsed.data.sourceStoreId,
    target_destination_store_id: parsed.data.destinationStoreId,
    target_note: parsed.data.note,
    target_lines: parsed.data.lines.map((line) => ({
      product_id: line.productId,
      variant_id: line.variantId || null,
      quantity: line.quantity,
    })) as Json,
  });

  if (error || !data) {
    return { ok: false, message: databaseMessage(error?.code, "TINDIO could not ship this transfer.") };
  }

  revalidatePath("/back-office/inventory");
  return { ok: true, message: "Transfer shipped. Receive it at the destination store.", data: { transferId: data } };
}

export async function updateInventoryPolicyAction(
  input: unknown,
): Promise<AdvancedInventoryActionResult> {
  const { context, error: permissionError } = await requireInventoryManager();
  if (permissionError) return { ok: false, message: permissionError };
  const parsed = updateInventoryPolicySchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_inventory_policy", {
    target_organization_id: context.organization.id,
    target_store_id: parsed.data.storeId,
    target_negative_stock_policy: parsed.data.negativeStockPolicy,
  });
  if (error) return { ok: false, message: databaseMessage(error.code, "TINDIO could not update the stock policy.") };
  revalidatePath("/back-office/inventory");
  return { ok: true, message: "Negative-stock policy updated." };
}

export async function createAdjustmentReasonAction(
  input: unknown,
): Promise<AdvancedInventoryActionResult> {
  const { context, error: permissionError } = await requireInventoryManager();
  if (permissionError) return { ok: false, message: permissionError };
  const parsed = createAdjustmentReasonSchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_inventory_adjustment_reason", {
    target_organization_id: context.organization.id,
    target_code: parsed.data.code.toUpperCase(),
    target_name: parsed.data.name,
    target_movement_type: parsed.data.movementType,
  });
  if (error) return { ok: false, message: databaseMessage(error.code, "TINDIO could not save that adjustment reason.") };
  revalidatePath("/back-office/inventory");
  return { ok: true, message: "Adjustment reason saved." };
}

export async function recordInventoryAdjustmentV2Action(
  input: unknown,
): Promise<AdvancedInventoryActionResult<{ movementId: string }>> {
  const { context, error: permissionError } = await requireInventoryManager();
  if (permissionError) return { ok: false, message: permissionError };
  const parsed = recordInventoryAdjustmentSchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_inventory_adjustment_v2", {
    target_organization_id: context.organization.id,
    target_store_id: parsed.data.storeId,
    target_product_id: parsed.data.productId,
    target_variant_id: (parsed.data.variantId || null) as never,
    target_quantity_delta: Number(parsed.data.quantityDelta),
    target_reason_code: parsed.data.reasonCode,
    target_note: parsed.data.note,
  });
  if (error || !data) return { ok: false, message: databaseMessage(error?.code, "TINDIO could not post the stock adjustment.") };
  revalidatePath("/back-office/inventory");
  return { ok: true, message: "Stock adjustment posted to the ledger.", data: { movementId: data } };
}

export async function receiveStockTransferAction(
  input: unknown,
): Promise<AdvancedInventoryActionResult<{ receiptId: string }>> {
  const { context, error: permissionError } = await requireInventoryManager();
  if (permissionError) return { ok: false, message: permissionError };
  if (!context.features.transfers) return { ok: false, message: "Stock transfers are disabled for this business." };
  const parsed = receiveStockTransferSchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("receive_stock_transfer", {
    target_organization_id: context.organization.id,
    target_stock_transfer_id: parsed.data.stockTransferId,
    target_note: parsed.data.note,
    target_lines: parsed.data.lines.map((line) => ({ stock_transfer_line_id: line.stockTransferLineId, quantity: line.quantity })) as Json,
  });
  if (error || !data) return { ok: false, message: databaseMessage(error?.code, "TINDIO could not receive this transfer.") };
  revalidatePath("/back-office/inventory");
  return { ok: true, message: "Transfer receipt posted and destination stock updated.", data: { receiptId: data } };
}

export async function returnToSupplierAction(
  input: unknown,
): Promise<AdvancedInventoryActionResult<{ supplierReturnId: string }>> {
  const { context, error: permissionError } = await requireInventoryManager();
  if (permissionError) return { ok: false, message: permissionError };
  if (!context.features.purchase_orders) return { ok: false, message: "Purchase orders are disabled for this business." };
  const parsed = returnToSupplierSchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("return_to_supplier", {
    target_organization_id: context.organization.id,
    target_store_id: parsed.data.storeId,
    target_supplier_id: parsed.data.supplierId,
    target_note: parsed.data.note,
    target_lines: parsed.data.lines.map((line) => ({ product_id: line.productId, variant_id: line.variantId || null, quantity: line.quantity })) as Json,
  });
  if (error || !data) return { ok: false, message: databaseMessage(error?.code, "TINDIO could not record the supplier return.") };
  revalidatePath("/back-office/inventory");
  return { ok: true, message: "Supplier return posted to the inventory ledger.", data: { supplierReturnId: data } };
}

export async function produceCompositeAction(
  input: unknown,
): Promise<AdvancedInventoryActionResult<{ productionRunId: string }>> {
  const { context, error: permissionError } = await requireInventoryManager();
  if (permissionError) return { ok: false, message: permissionError };
  if (!context.features.production) return { ok: false, message: "Production is disabled for this business." };
  const parsed = produceCompositeSchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("produce_composite", {
    target_organization_id: context.organization.id,
    target_store_id: parsed.data.storeId,
    target_product_id: parsed.data.productId,
    target_quantity: Number(parsed.data.quantity),
    target_note: parsed.data.note,
  });
  if (error || !data) return { ok: false, message: databaseMessage(error?.code, "TINDIO could not record production.") };
  revalidatePath("/back-office/inventory");
  return { ok: true, message: "Production posted with component consumption and cost valuation.", data: { productionRunId: data } };
}
