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
};

export type CatalogCostEntry = {
  product_id: string;
  variant_id: string | null;
  cost_minor: number;
};

export type CatalogWorkspace = {
  categories: CatalogCategoryRow[];
  stores: CatalogStoreRow[];
  products: CatalogProductRow[];
  variants: CatalogVariantRow[];
  settings: CatalogStoreSettingRow[];
  costs: CatalogCostEntry[];
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
