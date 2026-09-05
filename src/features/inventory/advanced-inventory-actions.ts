"use server";

import { revalidatePath } from "next/cache";

import { moneyInputToMinor } from "@/features/catalog/catalog-money";
import {
  completeInventoryCountSchema,
  createInventoryCountDraftSchema,
  createAdjustmentReasonSchema,
  createPurchaseOrderSchema,
  createSupplierSchema,
  importSuppliersCsvSchema,
  importInventoryAdjustmentsCsvSchema,
  inventoryCountTransitionSchema,
  produceCompositeSchema,
  receiveStockTransferSchema,
  receivePurchaseOrderSchema,
  recordInventoryAdjustmentSchema,
  saveInventoryCountLineSchema,
  returnToSupplierSchema,
  transferStockSchema,
  updateInventoryPolicySchema,
  updateSupplierSchema,
} from "@/features/inventory/advanced-inventory-schema";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";
import { postgresCodeMessage, validationFailure } from "@/lib/server/db-errors";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export type AdvancedInventoryActionResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function validationError(): AdvancedInventoryActionResult {
  return validationFailure();
}

const ADVANCED_INVENTORY_DB_MESSAGES: Record<string, string> = {
  "23505": "This supplier or inventory document already exists.",
  "23503": "Choose records that belong to this organization.",
  "23514": "The inventory details violate a business rule. Check available stock and quantities.",
  "22023": "The inventory details violate a business rule. Check available stock and quantities.",
  "42501": "You do not have permission to make this inventory change.",
};

function databaseMessage(code: string | undefined, fallback: string) {
  return postgresCodeMessage(code, fallback, ADVANCED_INVENTORY_DB_MESSAGES);
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

async function requireInventoryCounter() {
  const context = await requireBusinessContext();

  if (!context.features.inventory) {
    return { context, error: "Inventory is disabled for this business." };
  }

  if (!hasPermission(context, "inventory.count") && !hasPermission(context, "inventory.manage")) {
    return { context, error: "You do not have permission to perform inventory counts." };
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

export async function updateSupplierAction(
  input: unknown,
): Promise<AdvancedInventoryActionResult<{ supplierId: string }>> {
  const { context, error: permissionError } = await requireInventoryManager();
  if (permissionError) return { ok: false, message: permissionError };
  if (!context.features.purchase_orders) return { ok: false, message: "Purchase orders are disabled for this business." };

  const parsed = updateSupplierSchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("update_supplier", {
    target_organization_id: context.organization.id,
    target_supplier_id: parsed.data.supplierId,
    target_name: parsed.data.name,
    target_contact_name: parsed.data.contactName,
    target_email: parsed.data.email,
    target_phone: parsed.data.phone,
    target_address: parsed.data.address,
    target_notes: parsed.data.notes,
    target_is_active: parsed.data.isActive,
  });

  if (error || !data) {
    return { ok: false, message: databaseMessage(error?.code, "TINDIO could not update the supplier.") };
  }

  revalidatePath("/back-office/inventory");
  return { ok: true, message: "Supplier updated.", data: { supplierId: data } };
}

export async function importSuppliersCsvAction(input: unknown): Promise<AdvancedInventoryActionResult<{ importedCount: number }>> {
  const { context, error: permissionError } = await requireInventoryManager();
  if (permissionError) return { ok: false, message: permissionError };
  if (!context.features.purchase_orders) return { ok: false, message: "Purchase orders are disabled for this business." };
  const parsed = importSuppliersCsvSchema.safeParse(input);
  if (!parsed.success) return validationError();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_suppliers_csv", { target_organization_id: context.organization.id, target_rows: parsed.data.rows.map((row) => ({ row_number: row.rowNumber, name: row.name, contact_name: row.contactName, email: row.email, phone: row.phone, address: row.address, notes: row.notes })) as Json });
  if (error || data === null) return { ok: false, message: error?.message?.startsWith("CSV row") ? error.message : databaseMessage(error?.code, "TINDIO could not import this supplier CSV file.") };
  revalidatePath("/back-office/inventory");
  revalidatePath("/back-office/replenishment");
  return { ok: true, message: `${data} supplier${data === 1 ? "" : "s"} imported.`, data: { importedCount: data } };
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
  const { context, error: permissionError } = await requireInventoryCounter();
  if (permissionError) return { ok: false, message: permissionError };

  const parsed = completeInventoryCountSchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  // Preserve the existing review UI while making the database the source of
  // truth for each count transition. A failed save deliberately leaves the
  // draft unposted; it can never create a partial stock correction.
  const { data: inventoryCountId, error: createError } = await supabase.rpc("create_inventory_count_draft", {
    target_organization_id: context.organization.id,
    target_store_id: parsed.data.storeId,
    target_note: parsed.data.note,
  });

  if (createError || !inventoryCountId) {
    return { ok: false, message: databaseMessage(createError?.code, "TINDIO could not create the inventory-count document.") };
  }

  for (const line of parsed.data.lines) {
    const { error: lineError } = await supabase.rpc("save_inventory_count_line", {
      target_organization_id: context.organization.id,
      target_inventory_count_id: inventoryCountId,
      target_product_id: line.productId,
      target_variant_id: line.variantId || null,
      target_counted_quantity: Number(line.countedQuantity),
    });
    if (lineError) {
      return { ok: false, message: databaseMessage(lineError.code, "TINDIO saved the count draft but could not save one item. Review the draft before posting it.") };
    }
  }

  const { error: reviewError } = await supabase.rpc("submit_inventory_count_for_review", {
    target_organization_id: context.organization.id,
    target_inventory_count_id: inventoryCountId,
  });
  if (reviewError) {
    return { ok: false, message: databaseMessage(reviewError.code, "TINDIO saved the count draft but could not submit it for review.") };
  }

  const { error: postError } = await supabase.rpc("post_inventory_count", {
    target_organization_id: context.organization.id,
    target_inventory_count_id: inventoryCountId,
  });
  if (postError) {
    return { ok: false, message: databaseMessage(postError.code, "TINDIO saved the reviewed count but could not post its variance.") };
  }

  revalidatePath("/back-office/inventory");
  revalidatePath("/back-office/replenishment");
  return { ok: true, message: "Inventory count reviewed and variances posted.", data: { inventoryCountId } };
}

export async function createInventoryCountDraftAction(
  input: unknown,
): Promise<AdvancedInventoryActionResult<{ inventoryCountId: string }>> {
  const { context, error: permissionError } = await requireInventoryCounter();
  if (permissionError) return { ok: false, message: permissionError };
  const parsed = createInventoryCountDraftSchema.safeParse(input);
  if (!parsed.success) return validationError();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_inventory_count_plan", {
    target_count_mode: parsed.data.countMode,
    target_include_zero_stock: parsed.data.includeZeroStock,
    target_note: parsed.data.note,
    target_organization_id: context.organization.id,
    target_scope_reference_id: parsed.data.scopeReferenceId || null,
    target_scope_type: parsed.data.scopeType,
    target_selected_items: parsed.data.selectedItems.map((item) => ({
      product_id: item.productId,
      variant_id: item.variantId || null,
    })) as Json,
    target_sort_mode: parsed.data.sortMode,
    target_store_id: parsed.data.storeId,
  });
  if (error || !data) return { ok: false, message: databaseMessage(error?.code, "TINDIO could not prepare the inventory count.") };
  revalidatePath("/back-office/inventory");
  return { ok: true, message: "Count prepared. Record the physical quantities, then submit it for review.", data: { inventoryCountId: data } };
}

export async function saveInventoryCountLineAction(input: unknown): Promise<AdvancedInventoryActionResult> {
  const { context, error: permissionError } = await requireInventoryCounter();
  if (permissionError) return { ok: false, message: permissionError };
  const parsed = saveInventoryCountLineSchema.safeParse(input);
  if (!parsed.success) return validationError();
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_inventory_count_line", {
    target_organization_id: context.organization.id,
    target_inventory_count_id: parsed.data.inventoryCountId,
    target_product_id: parsed.data.productId,
    target_variant_id: parsed.data.variantId || null,
    target_counted_quantity: Number(parsed.data.countedQuantity),
  });
  if (error) return { ok: false, message: databaseMessage(error.code, "TINDIO could not save this physical count.") };
  revalidatePath("/back-office/inventory");
  return { ok: true, message: "Counted quantity saved." };
}

async function transitionInventoryCount(
  input: unknown,
  operation: "submit_inventory_count_for_review" | "post_inventory_count" | "cancel_inventory_count",
  successMessage: string,
): Promise<AdvancedInventoryActionResult> {
  const { context, error: permissionError } = await requireInventoryCounter();
  if (permissionError) return { ok: false, message: permissionError };
  const parsed = inventoryCountTransitionSchema.safeParse(input);
  if (!parsed.success) return validationError();
  const supabase = await createClient();
  const { error } = operation === "cancel_inventory_count"
    ? await supabase.rpc(operation, {
        target_organization_id: context.organization.id,
        target_inventory_count_id: parsed.data.inventoryCountId,
        target_note: parsed.data.note ?? "",
      })
    : await supabase.rpc(operation, {
        target_organization_id: context.organization.id,
        target_inventory_count_id: parsed.data.inventoryCountId,
      });
  if (error) return { ok: false, message: databaseMessage(error.code, "TINDIO could not update this inventory-count document.") };
  revalidatePath("/back-office/inventory");
  revalidatePath("/back-office/replenishment");
  return { ok: true, message: successMessage };
}

export async function submitInventoryCountForReviewAction(input: unknown) {
  return transitionInventoryCount(input, "submit_inventory_count_for_review", "Inventory count is ready for review.");
}

export async function postInventoryCountAction(input: unknown) {
  return transitionInventoryCount(input, "post_inventory_count", "Inventory count posted. Variances are now in the immutable activity ledger.");
}

export async function cancelInventoryCountAction(input: unknown) {
  return transitionInventoryCount(input, "cancel_inventory_count", "Inventory count cancelled. No stock variance was posted.");
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

export async function importInventoryAdjustmentsCsvAction(input: unknown): Promise<AdvancedInventoryActionResult<{ importedCount: number }>> {
  const { context, error: permissionError } = await requireInventoryManager();
  if (permissionError) return { ok: false, message: permissionError };
  const parsed = importInventoryAdjustmentsCsvSchema.safeParse(input);
  if (!parsed.success) return validationError();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_inventory_adjustments_csv", {
    target_organization_id: context.organization.id,
    target_store_id: parsed.data.storeId,
    target_reason_code: parsed.data.reasonCode,
    target_rows: parsed.data.rows.map((row) => ({ row_number: row.rowNumber, product_id: row.productId, variant_id: row.variantId || "", quantity_delta: row.quantityDelta, note: row.note })) as Json,
  });
  if (error || data === null) return { ok: false, message: error?.message?.startsWith("CSV row") ? error.message : databaseMessage(error?.code, "TINDIO could not import these inventory adjustments.") };
  revalidatePath("/back-office/inventory");
  return { ok: true, message: `${data} inventory adjustment${data === 1 ? "" : "s"} posted to the ledger.`, data: { importedCount: data } };
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
