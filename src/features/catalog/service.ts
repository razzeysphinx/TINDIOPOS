import "server-only";

import { moneyInputToMinor } from "@/features/catalog/catalog-money";
import {
  createCategorySchema,
  createProductComponentSchema,
  createProductSchema,
  createProductUnitSchema,
  generateCatalogIdentifiersSchema,
  importCatalogCsvSchema,
  setCategoryArchivedSchema,
  setProductArchivedSchema,
  setProductAvailabilitySchema,
  setProductStoreAvailabilitySchema,
  setProductStoreConfigurationSchema,
  updateCategorySchema,
  updateProductSchema,
} from "@/features/catalog/catalog-schema";
import type { CatalogActionResult } from "@/features/catalog/catalog-types";
import { hasPermission, type BusinessContext } from "@/lib/auth/dal";
import {
  PERMISSION_DENIED_MESSAGE,
  postgresCodeMessage,
  validationFailure,
} from "@/lib/server/db-errors";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export function validationError(): CatalogActionResult {
  return validationFailure();
}

const CATALOG_DB_MESSAGES: Record<string, string> = {
  "23505": "That category name, SKU, or barcode is already in use.",
  "23503": "Select a category and store that belong to this organization.",
  "23514": "The catalogue or stock details violate a business rule.",
  "22023": "The catalogue or stock details violate a business rule.",
  "42501": PERMISSION_DENIED_MESSAGE,
};

export function databaseMessage(code: string | undefined, fallback: string) {
  return postgresCodeMessage(code, fallback, CATALOG_DB_MESSAGES);
}

export async function generateCatalogIdentifiers(
  context: BusinessContext,
  input: unknown,
): Promise<CatalogActionResult<{ sku: string; barcode: string }>> {
  const parsed = generateCatalogIdentifiersSchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("generate_catalog_identifiers", {
    target_organization_id: context.organization.id,
    target_product_name: parsed.data.productName,
  });
  const identifiers = data?.[0];

  if (error || !identifiers) {
    return {
      ok: false,
      message: databaseMessage(error?.code, "TINDIO could not generate product identifiers."),
    };
  }

  return {
    ok: true,
    message: "TINDIO SKU and barcode generated.",
    data: identifiers,
  };
}

export async function createCategory(
  context: BusinessContext,
  input: unknown,
): Promise<CatalogActionResult> {
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

  return { ok: true, message: "Category created." };
}

export async function setCategoryArchived(
  context: BusinessContext,
  input: unknown,
): Promise<CatalogActionResult> {
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

  return {
    ok: true,
    message: parsed.data.isArchived ? "Category archived." : "Category restored.",
  };
}

export async function updateCategory(
  context: BusinessContext,
  input: unknown,
): Promise<CatalogActionResult> {
  const parsed = updateCategorySchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .update({
      name: parsed.data.name,
      description: parsed.data.description || null,
      icon: parsed.data.icon,
      color: parsed.data.color,
      sort_order: parsed.data.sortOrder,
    })
    .eq("id", parsed.data.categoryId)
    .eq("organization_id", context.organization.id)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return {
      ok: false,
      message: databaseMessage(error?.code, "TINDIO could not update the category."),
    };
  }

  return { ok: true, message: "Category updated." };
}

export async function createProduct(
  context: BusinessContext,
  input: unknown,
): Promise<CatalogActionResult<{ productId: string }>> {
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

  return { ok: true, message: "Product created.", data: { productId: data } };
}

export async function setProductArchived(
  context: BusinessContext,
  input: unknown,
): Promise<CatalogActionResult> {
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

  return {
    ok: true,
    message: parsed.data.isArchived ? "Product archived." : "Product restored.",
  };
}

export async function updateProduct(
  context: BusinessContext,
  input: unknown,
): Promise<CatalogActionResult> {
  const parsed = updateProductSchema.safeParse(input);
  if (!parsed.success) return validationError();

  if (!context.features.inventory && parsed.data.trackInventory) {
    return { ok: false, message: "Inventory is disabled for this business." };
  }

  if (!context.features.weighted_products && parsed.data.allowFractionalQuantity) {
    return { ok: false, message: "Weighted products are disabled for this business." };
  }

  const canViewCost = hasPermission(context, "products.view_cost");
  const productCost = moneyInputToMinor(parsed.data.cost);

  const supabase = await createClient();
  const { data: productType, error } = await supabase.rpc("update_catalog_product_v2", {
    target_organization_id: context.organization.id,
    target_product_id: parsed.data.productId,
    target_name: parsed.data.name,
    target_description: parsed.data.description,
    target_category_id: (parsed.data.categoryId || null) as never,
    target_sku: parsed.data.sku,
    target_barcode: parsed.data.barcode,
    target_price_minor: moneyInputToMinor(parsed.data.price),
    // A caller who cannot view cost also cannot safely send the form's
    // placeholder value. Null tells the database routine to retain the
    // authoritative existing cost while it updates the other product fields.
    target_cost_minor: (canViewCost ? productCost : null) as never,
    target_track_inventory: parsed.data.trackInventory,
    target_unit: parsed.data.unit,
    target_image_url: parsed.data.imageUrl,
    target_is_variable_price: parsed.data.isVariablePrice,
    target_allow_fractional_quantity: parsed.data.allowFractionalQuantity,
  });

  if (error || !productType) {
    return {
      ok: false,
      message: databaseMessage(error?.code, "TINDIO could not update the product."),
    };
  }

  return {
    ok: true,
    message: productType === "variable" ? "Product details updated." : "Product updated.",
  };
}

export async function setProductAvailability(
  context: BusinessContext,
  input: unknown,
): Promise<CatalogActionResult> {
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

  return { ok: true, message: "Store availability updated." };
}

/**
 * Reconciles one product's availability across the caller's authorized active
 * stores. An unselected store becomes unavailable instead of being deleted, so
 * its configuration and inventory history remain intact.
 */
export async function setProductStoreAvailability(
  context: BusinessContext,
  input: unknown,
): Promise<CatalogActionResult> {
  const parsed = setProductStoreAvailabilitySchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const [productResult, activeStoresResult, settingsResult] = await Promise.all([
    supabase
      .from("products")
      .select("id")
      .eq("id", parsed.data.productId)
      .eq("organization_id", context.organization.id)
      .maybeSingle(),
    supabase
      .from("stores")
      .select("id")
      .eq("organization_id", context.organization.id)
      .eq("is_active", true),
    supabase
      .from("product_store_settings")
      .select("store_id, is_available")
      .eq("organization_id", context.organization.id)
      .eq("product_id", parsed.data.productId),
  ]);

  if (productResult.error || !productResult.data) {
    return { ok: false, message: "The product could not be found." };
  }

  if (activeStoresResult.error || settingsResult.error) {
    return { ok: false, message: "Store availability could not be updated." };
  }

  const activeStoreIds = new Set((activeStoresResult.data ?? []).map((store) => store.id));
  if (activeStoreIds.size === 0) {
    return { ok: false, message: "No active stores are available for this product." };
  }

  const selectedStoreIds = new Set(parsed.data.storeIds);
  if ([...selectedStoreIds].some((storeId) => !activeStoreIds.has(storeId))) {
    return { ok: false, message: "Select only active stores you are allowed to manage." };
  }

  const availabilityByStoreId = new Map(
    (settingsResult.data ?? []).map((setting) => [setting.store_id, Boolean(setting.is_available)]),
  );
  const changes = [...activeStoreIds]
    .filter((storeId) => availabilityByStoreId.get(storeId) !== selectedStoreIds.has(storeId))
    .map((storeId) => ({
      organization_id: context.organization.id,
      product_id: parsed.data.productId,
      store_id: storeId,
      is_available: selectedStoreIds.has(storeId),
    }));

  if (changes.length === 0) {
    return { ok: true, message: "Store availability is already up to date." };
  }

  const { error } = await supabase
    .from("product_store_settings")
    .upsert(changes, { onConflict: "store_id,product_id" });

  if (error) {
    return {
      ok: false,
      message: databaseMessage(error.code, "Store availability could not be updated."),
    };
  }

  return {
    ok: true,
    message: `${selectedStoreIds.size} active store${selectedStoreIds.size === 1 ? " is" : "s are"} now available for this product.`,
  };
}

export async function setProductStoreConfiguration(
  context: BusinessContext,
  input: unknown,
): Promise<CatalogActionResult> {
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
  return { ok: true, message: "Store price and low-stock settings updated." };
}

export async function createProductUnit(
  context: BusinessContext,
  input: unknown,
): Promise<CatalogActionResult> {
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
  return { ok: true, message: "Product unit added." };
}

export async function createProductComponent(
  context: BusinessContext,
  input: unknown,
): Promise<CatalogActionResult> {
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
  return { ok: true, message: "Composite component added." };
}

export async function importCatalogCsv(
  context: BusinessContext,
  input: unknown,
): Promise<CatalogActionResult<{ importedCount: number }>> {
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

  return {
    ok: true,
    message: `${data} product${data === 1 ? "" : "s"} imported.`,
    data: { importedCount: data },
  };
}
