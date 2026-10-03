import type {
  PosCatalogItem,
} from "../../../../../src/contracts/pos";
import {
  getTindioDatabase,
} from "../../db/database";
import {
  recordSqliteQuery,
} from "../performance/performance-metrics";
import {
  incrementLocalFirstMetric,
} from "./runtime-metrics";

type Row = {
  payload_json: string;
};

const decode = (
  row: Row,
) => {
  try {
    return JSON.parse(
      row.payload_json,
    ) as PosCatalogItem;
  } catch {
    return null;
  }
};

export async function searchLocalCatalog(
  input: {
    organizationId: string;
    storeId: string;
    query?: string;
    categoryId?: string | null;
    limit?: number;
    offset?: number;
  },
) {
  incrementLocalFirstMetric(
    "sqliteCatalogReads",
  );

  const startedAt =
    Date.now();

  const query =
    input.query
      ?.trim()
      .toLocaleLowerCase()
    ?? "";

  const rows =
    await (
      await getTindioDatabase()
    ).getAllAsync<Row>(
      "SELECT payload_json FROM catalog_items WHERE organization_id=? AND store_id=? AND (?='' OR search_text LIKE ?) AND (? IS NULL OR category_id=?) ORDER BY product_name COLLATE NOCASE,variant_name COLLATE NOCASE LIMIT ? OFFSET ?",
      input.organizationId,
      input.storeId,
      query,
      query
        ? `${query}%`
        : "%",
      input.categoryId
        ?? null,
      input.categoryId
        ?? null,
      Math.min(
        Math.max(
          input.limit ?? 24,
          1,
        ),
        100,
      ),
      Math.max(
        input.offset ?? 0,
        0,
      ),
    );

  recordSqliteQuery({
    kind:
      "CATALOG_SEARCH",
    durationMs:
      Date.now()
      - startedAt,
    rowsReturned:
      rows.length,
  });

  return rows
    .map(decode)
    .filter(
      (
        item,
      ): item is PosCatalogItem =>
        Boolean(item),
    );
}

async function lookup(
  organizationId: string,
  storeId: string,
  column:
    | "barcode"
    | "sku",
  value: string,
) {
  const normalized =
    value.trim();

  if (!normalized) {
    return null;
  }

  incrementLocalFirstMetric(
    "sqliteBarcodeReads",
  );

  const startedAt =
    Date.now();

  const row =
    await (
      await getTindioDatabase()
    ).getFirstAsync<Row>(
      `SELECT payload_json FROM catalog_items WHERE organization_id=? AND store_id=? AND ${column}=? LIMIT 1`,
      organizationId,
      storeId,
      normalized,
    );

  recordSqliteQuery({
    kind:
      column === "barcode"
        ? "BARCODE_LOOKUP"
        : "SKU_LOOKUP",
    durationMs:
      Date.now()
      - startedAt,
    rowsReturned:
      row ? 1 : 0,
  });

  return row
    ? decode(row)
    : null;
}

export const lookupLocalBarcode = (
  organizationId: string,
  storeId: string,
  value: string,
) =>
  lookup(
    organizationId,
    storeId,
    "barcode",
    value,
  );

export const lookupLocalSku = (
  organizationId: string,
  storeId: string,
  value: string,
) =>
  lookup(
    organizationId,
    storeId,
    "sku",
    value,
  );

export async function getLocalCatalogItem(
  organizationId: string,
  storeId: string,
  productId: string,
  variantId: string | null,
) {
  const row =
    await (
      await getTindioDatabase()
    ).getFirstAsync<Row>(
      "SELECT payload_json FROM catalog_items WHERE organization_id=? AND store_id=? AND item_key=? LIMIT 1",
      organizationId,
      storeId,
      `${productId}:${variantId ?? "simple"}`,
    );

  return row
    ? decode(row)
    : null;
}