"use server";

import { revalidatePath } from "next/cache";

import { moneyInputToMinor } from "@/features/catalog/catalog-money";
import {
  adjustInventorySchema,
  createCategorySchema,
  createProductSchema,
  setCategoryArchivedSchema,
  setProductArchivedSchema,
  setProductAvailabilitySchema,
  setProductStoreConfigurationSchema,
  createProductUnitSchema,
  createProductComponentSchema,
  importCatalogCsvSchema,
} from "@/features/catalog/catalog-schema";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export type CatalogActionResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function validationError(): CatalogActionResult {
  return {
    ok: false,
    message: "Check the highlighted details and try again.",
  };
}

function databaseMessage(code: string | undefined, fallback: string) {
  if (code === "23505") {
    return "That category name, SKU, or barcode is already in use.";
  }

  if (code === "23503") {
    return "Select a category and store that belong to this organization.";
  }

  if (code === "23514" || code === "22023") {
    return "The catalogue or stock details violate a business rule.";
  }

  if (code === "42501") {
    return "You do not have permission to make this change.";
  }

  return fallback;
}

export async function createCategoryAction(
  input: unknown,
): Promise<CatalogActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "products.manage")) {
    return { ok: false, message: "You do not have permission to create categories." };
  }

  const parsed = createCategorySchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { error } = await supabase.from("categories").insert({
    organization_id: context.organization.id,
    name: parsed.data.name,
    description: parsed.data.description || null,
    icon: parsed.data.icon,
    color: parsed.data.color,
    sort_order: parsed.data.sortOrder,
  });

  if (error) {
    return {
      ok: false,
      message: databaseMessage(error.code, "TINDIO could not create the category."),
    };
  }

  revalidatePath("/back-office/categories");
  revalidatePath("/back-office/catalog");
  return { ok: true, message: "Category created." };
}

export async function setCategoryArchivedAction(
  input: unknown,
): Promise<CatalogActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "products.manage")) {
    return { ok: false, message: "You do not have permission to archive categories." };
  }

  const parsed = setCategoryArchivedSchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .update({ is_archived: parsed.data.isArchived })
    .eq("id", parsed.data.categoryId)
    .eq("organization_id", context.organization.id)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return { ok: false, message: "The category could not be updated." };
  }

  revalidatePath("/back-office/categories");
  revalidatePath("/back-office/catalog");
  return {
    ok: true,
    message: parsed.data.isArchived ? "Category archived." : "Category restored.",
  };
}

export async function createProductAction(
  input: unknown,
): Promise<CatalogActionResult<{ productId: string }>> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "products.manage")) {
    return { ok: false, message: "You do not have permission to create products." };
  }

  const parsed = createProductSchema.safeParse(input);
  if (!parsed.success) return validationError();

  if (!context.features.inventory && parsed.data.trackInventory) {
    return { ok: false, message: "Inventory is disabled for this business, so new products cannot track stock." };
  }

  if (!context.features.weighted_products && parsed.data.allowFractionalQuantity) {
    return { ok: false, message: "Weighted products are disabled for this business." };
  }

  const productCost = moneyInputToMinor(parsed.data.cost);
  const variantCosts = parsed.data.variants.map((variant) =>
    moneyInputToMinor(variant.cost),
  );

  if (
    !hasPermission(context, "products.view_cost") &&
    (productCost !== 0 || variantCosts.some((cost) => cost !== 0))
  ) {
    return { ok: false, message: "You do not have permission to enter product cost." };
  }

  const variants: Json = parsed.data.variants.map((variant, index) => ({
    name: variant.name,
    option_values: {},
    sku: variant.sku,
    barcode: variant.barcode,
    price_minor: moneyInputToMinor(variant.price),
    cost_minor: moneyInputToMinor(variant.cost),
    sort_order: index,
  }));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_catalog_product_v2", {
    target_organization_id: context.organization.id,
    // Supabase's generated RPC types do not preserve nullable PostgreSQL
    // function arguments. The database accepts null for an uncategorized item.
    target_category_id: (parsed.data.categoryId || null) as never,
    target_name: parsed.data.name,
    target_description: parsed.data.description,
    target_product_type: parsed.data.productType,
    target_sku: parsed.data.sku,
    target_barcode: parsed.data.barcode,
    target_price_minor: moneyInputToMinor(parsed.data.price),
    target_cost_minor: productCost,
    target_track_inventory: parsed.data.trackInventory,
    target_unit: parsed.data.unit,
    target_store_ids: parsed.data.storeIds,
    target_variants: variants,
    target_image_url: parsed.data.imageUrl,
    target_is_variable_price: parsed.data.isVariablePrice,
    target_allow_fractional_quantity: parsed.data.allowFractionalQuantity,
  });

  if (error || !data) {
    return {
      ok: false,
      message: databaseMessage(error?.code, "TINDIO could not create the product."),
    };
  }

  revalidatePath("/back-office/catalog");
  revalidatePath("/back-office/inventory");
  return { ok: true, message: "Product created.", data: { productId: data } };
}

export async function setProductArchivedAction(
  input: unknown,
): Promise<CatalogActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "products.manage")) {
    return { ok: false, message: "You do not have permission to archive products." };
  }

  const parsed = setProductArchivedSchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .update({ status: parsed.data.isArchived ? "archived" : "active" })
    .eq("id", parsed.data.productId)
    .eq("organization_id", context.organization.id)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return { ok: false, message: "The product could not be updated." };
  }

  revalidatePath("/back-office/catalog");
  revalidatePath("/back-office/inventory");
  return {
    ok: true,
    message: parsed.data.isArchived ? "Product archived." : "Product restored.",
  };
}

export async function setProductAvailabilityAction(
  input: unknown,
): Promise<CatalogActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "products.manage")) {
    return { ok: false, message: "You do not have permission to change availability." };
  }

  const parsed = setProductAvailabilitySchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_store_settings")
    .upsert(
      {
        organization_id: context.organization.id,
        product_id: parsed.data.productId,
        store_id: parsed.data.storeId,
        is_available: parsed.data.isAvailable,
      },
      { onConflict: "store_id,product_id" },
    )
    .select("product_id")
    .maybeSingle();

  if (error || !data) {
    return { ok: false, message: "Store availability could not be updated." };
  }

  revalidatePath("/back-office/catalog");
  revalidatePath("/back-office/inventory");
  return { ok: true, message: "Store availability updated." };
}

export async function setProductStoreConfigurationAction(input: unknown): Promise<CatalogActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "products.manage")) return { ok: false, message: "You do not have permission to configure store products." };
  const parsed = setProductStoreConfigurationSchema.safeParse(input);
  if (!parsed.success) return validationError();
  const supabase = await createClient();
  const { error } = await supabase.from("product_store_settings").upsert({
    organization_id: context.organization.id,
    product_id: parsed.data.productId,
    store_id: parsed.data.storeId,
    is_available: true,
    price_override_minor: parsed.data.priceOverride ? moneyInputToMinor(parsed.data.priceOverride) : null,
    low_stock_level: parsed.data.lowStockLevel ? Number(parsed.data.lowStockLevel) : null,
  }, { onConflict: "store_id,product_id" });
  if (error) return { ok: false, message: databaseMessage(error.code, "Store product settings could not be updated.") };
  revalidatePath("/back-office/catalog");
  revalidatePath("/back-office/inventory");
  return { ok: true, message: "Store price and low-stock settings updated." };
}

export async function createProductUnitAction(input: unknown): Promise<CatalogActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "products.manage")) return { ok: false, message: "You do not have permission to manage product units." };
  const parsed = createProductUnitSchema.safeParse(input);
  if (!parsed.success) return validationError();
  const supabase = await createClient();
  const { error } = await supabase.from("product_units").insert({
    organization_id: context.organization.id,
    product_id: parsed.data.productId,
    unit_code: parsed.data.unitCode.toLowerCase(),
    unit_name: parsed.data.unitName,
    factor_to_base: Number(parsed.data.factorToBase),
    is_sale_unit: parsed.data.isSaleUnit,
    is_purchase_unit: parsed.data.isPurchaseUnit,
  });
  if (error) return { ok: false, message: databaseMessage(error.code, "The product unit could not be added.") };
  revalidatePath("/back-office/catalog");
  return { ok: true, message: "Product unit added." };
}

export async function createProductComponentAction(input: unknown): Promise<CatalogActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "products.manage")) return { ok: false, message: "You do not have permission to manage composite recipes." };
  const parsed = createProductComponentSchema.safeParse(input);
  if (!parsed.success) return validationError();
  const supabase = await createClient();
  const { error } = await supabase.from("product_components").insert({
    organization_id: context.organization.id,
    product_id: parsed.data.productId,
    component_product_id: parsed.data.componentProductId,
    component_variant_id: parsed.data.componentVariantId || null,
    quantity_per_composite: Number(parsed.data.quantityPerComposite),
  });
  if (error) return { ok: false, message: databaseMessage(error.code, "The component could not be added. Check the composite, item type, and recipe cycle.") };
  revalidatePath("/back-office/catalog");
  return { ok: true, message: "Composite component added." };
}

export async function importCatalogCsvAction(
  input: unknown,
): Promise<CatalogActionResult<{ importedCount: number }>> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "products.manage")) {
    return { ok: false, message: "You do not have permission to import products." };
  }

  const parsed = importCatalogCsvSchema.safeParse(input);
  if (!parsed.success) return validationError();

  if (!context.features.inventory && parsed.data.rows.some((row) => row.trackInventory)) {
    return {
      ok: false,
      message: "Inventory is disabled for this business, so imported products cannot track stock.",
    };
  }

  if (
    !context.features.weighted_products &&
    parsed.data.rows.some((row) => row.allowFractionalQuantity)
  ) {
    return { ok: false, message: "Weighted products are disabled for this business." };
  }

  const categoryNames = [...new Set(
    parsed.data.rows.map((row) => row.categoryName.trim().toLocaleLowerCase()).filter(Boolean),
  )];
  const supabase = await createClient();
  const categoriesResult = await supabase
    .from("categories")
    .select("id, name")
    .eq("organization_id", context.organization.id)
    .eq("is_archived", false);

  if (categoriesResult.error) {
    return { ok: false, message: "TINDIO could not validate CSV categories." };
  }

  const categoryIdByName = new Map(
    (categoriesResult.data ?? []).map((category) => [
      category.name.trim().toLocaleLowerCase(),
      category.id,
    ]),
  );
  const missingCategory = categoryNames.find((name) => !categoryIdByName.has(name));

  if (missingCategory) {
    const row = parsed.data.rows.find(
      (candidate) => candidate.categoryName.trim().toLocaleLowerCase() === missingCategory,
    );
    return {
      ok: false,
      message: `CSV row ${row?.rowNumber ?? "?"}: category “${row?.categoryName}” is not active in this organization.`,
    };
  }

  if (
    !hasPermission(context, "products.view_cost") &&
    parsed.data.rows.some((row) => moneyInputToMinor(row.cost) !== 0)
  ) {
    return { ok: false, message: "You do not have permission to import product costs." };
  }

  const rows: Json = parsed.data.rows.map((row) => ({
    row_number: row.rowNumber,
    name: row.name,
    description: row.description,
    category_id: row.categoryName
      ? categoryIdByName.get(row.categoryName.trim().toLocaleLowerCase()) ?? null
      : null,
    sku: row.sku,
    barcode: row.barcode,
    price_minor: moneyInputToMinor(row.price),
    cost_minor: moneyInputToMinor(row.cost),
    track_inventory: row.trackInventory,
    unit: row.unit,
    image_url: row.imageUrl,
    is_variable_price: row.isVariablePrice,
    allow_fractional_quantity: row.allowFractionalQuantity,
    price_override_minor: row.priceOverride ? moneyInputToMinor(row.priceOverride) : null,
    low_stock_level: row.lowStockLevel ? Number(row.lowStockLevel) : null,
  }));
  const { data, error } = await supabase.rpc("import_catalog_products_v2", {
    target_organization_id: context.organization.id,
    target_store_ids: parsed.data.storeIds,
    target_rows: rows,
  });

  if (error || data === null) {
    const rowMessage = error?.message?.startsWith("CSV row") ? error.message : null;
    return {
      ok: false,
      message: rowMessage ?? databaseMessage(error?.code, "TINDIO could not import this CSV file."),
    };
  }

  revalidatePath("/back-office/catalog");
  revalidatePath("/back-office/inventory");
  return {
    ok: true,
    message: `${data} product${data === 1 ? "" : "s"} imported.`,
    data: { importedCount: data },
  };
}

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
