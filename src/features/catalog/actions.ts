"use server";

import { revalidatePath } from "next/cache";

import { adjustInventorySchema } from "@/features/catalog/catalog-schema";
import type { CatalogActionResult } from "@/features/catalog/catalog-types";
import {
  createCategory,
  createProduct,
  createProductComponent,
  createProductUnit,
  databaseMessage,
  generateCatalogIdentifiers,
  importCatalogCsv,
  setCategoryArchived,
  setProductArchived,
  setProductAvailability,
  setProductStoreConfiguration,
  updateCategory,
  updateProduct,
  validationError,
} from "@/features/catalog/service";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export async function createCategoryAction(
  input: unknown,
): Promise<CatalogActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "products.manage")) {
    return { ok: false, message: "You do not have permission to create categories." };
  }

  const result = await createCategory(context, input);

  if (result.ok) {
    revalidatePath("/back-office/categories");
    revalidatePath("/back-office/catalog");
  }

  return result;
}

export async function setCategoryArchivedAction(
  input: unknown,
): Promise<CatalogActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "products.manage")) {
    return { ok: false, message: "You do not have permission to archive categories." };
  }

  const result = await setCategoryArchived(context, input);

  if (result.ok) {
    revalidatePath("/back-office/categories");
    revalidatePath("/back-office/catalog");
  }

  return result;
}

export async function updateCategoryAction(
  input: unknown,
): Promise<CatalogActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "products.manage")) {
    return { ok: false, message: "You do not have permission to update categories." };
  }

  const result = await updateCategory(context, input);

  if (result.ok) {
    revalidatePath("/back-office/categories");
    revalidatePath("/back-office/catalog");
  }

  return result;
}

export async function createProductAction(
  input: unknown,
): Promise<CatalogActionResult<{ productId: string }>> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "products.manage")) {
    return { ok: false, message: "You do not have permission to create products." };
  }

  const result = await createProduct(context, input);

  if (result.ok) {
    revalidatePath("/back-office/catalog");
    revalidatePath("/back-office/inventory");
  }

  return result;
}

export async function generateCatalogIdentifiersAction(
  input: unknown,
): Promise<CatalogActionResult<{ sku: string; barcode: string }>> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "products.manage")) {
    return { ok: false, message: "You do not have permission to generate product identifiers." };
  }

  return generateCatalogIdentifiers(context, input);
}

export async function setProductArchivedAction(
  input: unknown,
): Promise<CatalogActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "products.manage")) {
    return { ok: false, message: "You do not have permission to archive products." };
  }

  const result = await setProductArchived(context, input);

  if (result.ok) {
    revalidatePath("/back-office/catalog");
    revalidatePath("/back-office/inventory");
  }

  return result;
}

export async function updateProductAction(
  input: unknown,
): Promise<CatalogActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "products.manage")) {
    return { ok: false, message: "You do not have permission to update products." };
  }

  const result = await updateProduct(context, input);

  if (result.ok) {
    revalidatePath("/back-office/catalog");
    revalidatePath("/back-office/inventory");
  }

  return result;
}

export async function setProductAvailabilityAction(
  input: unknown,
): Promise<CatalogActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "products.manage")) {
    return { ok: false, message: "You do not have permission to change availability." };
  }

  const result = await setProductAvailability(context, input);

  if (result.ok) {
    revalidatePath("/back-office/catalog");
    revalidatePath("/back-office/inventory");
  }

  return result;
}

export async function setProductStoreConfigurationAction(input: unknown): Promise<CatalogActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "products.manage")) return { ok: false, message: "You do not have permission to configure store products." };
  const result = await setProductStoreConfiguration(context, input);
  if (result.ok) {
    revalidatePath("/back-office/catalog");
    revalidatePath("/back-office/inventory");
  }
  return result;
}

export async function createProductUnitAction(input: unknown): Promise<CatalogActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "products.manage")) return { ok: false, message: "You do not have permission to manage product units." };
  const result = await createProductUnit(context, input);
  if (result.ok) revalidatePath("/back-office/catalog");
  return result;
}

export async function createProductComponentAction(input: unknown): Promise<CatalogActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "products.manage")) return { ok: false, message: "You do not have permission to manage composite recipes." };
  const result = await createProductComponent(context, input);
  if (result.ok) revalidatePath("/back-office/catalog");
  return result;
}

export async function importCatalogCsvAction(
  input: unknown,
): Promise<CatalogActionResult<{ importedCount: number }>> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "products.manage")) {
    return { ok: false, message: "You do not have permission to import products." };
  }

  const result = await importCatalogCsv(context, input);

  if (result.ok) {
    revalidatePath("/back-office/catalog");
    revalidatePath("/back-office/inventory");
  }

  return result;
}

// Deferred from the catalog layer split: this entry point performs stock
// adjustments, opening-stock movements, and inventory ledger mutations via the
// controlled `adjust_inventory` RPC. Its implementation is intentionally left
// untouched until the inventory slice.
export async function adjustInventoryAction(
  input: unknown,
): Promise<CatalogActionResult<{ movementId: string }>> {
  const context = await requireBusinessContext();

  if (!context.features.inventory) {
    return { ok: false, message: "Inventory is disabled for this business." };
  }

  const parsed = adjustInventorySchema.safeParse(input);
  if (!parsed.success) return validationError();

  if (!hasPermission(context, "inventory.manage") && !parsed.data.approvalRequestId) {
    return { ok: false, message: "You do not have permission to adjust inventory." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("adjust_inventory", {
    target_organization_id: context.organization.id,
    target_store_id: parsed.data.storeId,
    target_product_id: parsed.data.productId,
    target_variant_id: (parsed.data.variantId || null) as never,
    target_quantity_delta: Number(parsed.data.quantityDelta),
    target_movement_type: parsed.data.movementType,
    target_reason: parsed.data.reason,
    ...(parsed.data.approvalRequestId
      ? { target_approval_request_id: parsed.data.approvalRequestId }
      : {}),
  });

  if (error || !data) {
    return {
      ok: false,
      message: databaseMessage(error?.code, "TINDIO could not record the stock movement."),
    };
  }

  revalidatePath("/back-office/inventory");
  return { ok: true, message: "Inventory updated.", data: { movementId: data } };
}
