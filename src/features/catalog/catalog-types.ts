export type CatalogActionResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

export type CatalogCategoryRow = {
  id: string;
  name: string;
  is_archived: boolean;
};

export type CatalogStoreRow = {
  id: string;
  name: string;
  is_active: boolean;
};

export type CatalogProductRow = {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  product_type: string;
  sku: string | null;
  barcode: string | null;
  price_minor: number;
  track_inventory: boolean;
  unit: string;
  image_url: string | null;
  is_variable_price: boolean;
  allow_fractional_quantity: boolean;
  is_composite: boolean;
  status: string;
  created_at: string;
};

export type CatalogVariantRow = {
  id: string;
  product_id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  price_minor: number;
  sort_order: number | null;
  is_active: boolean | null;
};

export type CatalogStoreSettingRow = {
  product_id: string;
  store_id: string;
  is_available: boolean | null;
  price_override_minor: number | null;
  low_stock_level: number | null;
  restock_policy: "restock" | "do_not_restock";
};

export type CatalogCostEntry = {
  product_id: string;
  variant_id: string | null;
  cost_minor: number;
};

export type CatalogInventoryLevelRow = {
  product_id: string;
  variant_id: string | null;
  store_id: string;
  quantity: number;
};

export type CatalogProductUnitRow = {
  id: string;
  product_id: string;
  unit_code: string;
  unit_name: string;
  factor_to_base: number;
  is_base: boolean;
  is_sale_unit: boolean;
  is_purchase_unit: boolean;
};

export type CatalogProductComponentRow = {
  id: string;
  product_id: string;
  component_product_id: string;
  component_variant_id: string | null;
  quantity_per_composite: number;
};

export type CatalogWorkspace = {
  categories: CatalogCategoryRow[];
  stores: CatalogStoreRow[];
  products: CatalogProductRow[];
  variants: CatalogVariantRow[];
  settings: CatalogStoreSettingRow[];
  costs: CatalogCostEntry[];
  inventoryLevels: CatalogInventoryLevelRow[];
  units: CatalogProductUnitRow[];
  components: CatalogProductComponentRow[];
};

export type CatalogExportProductRow = {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  sku: string | null;
  barcode: string | null;
  price_minor: number;
  track_inventory: boolean;
  unit: string;
  image_url: string | null;
  is_variable_price: boolean;
  allow_fractional_quantity: boolean;
};

export type CatalogExportData =
  | {
      ok: true;
      categories: Array<{ id: string; name: string }>;
      products: CatalogExportProductRow[];
      costs: CatalogCostEntry[];
    }
  | { ok: false; stage: "catalog" | "costs" };
