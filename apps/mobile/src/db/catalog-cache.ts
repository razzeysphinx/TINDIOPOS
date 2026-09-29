import type { PosCatalogItem, PosCatalogV2Response } from "../../../../src/contracts/pos";
import { saveLocalCacheState } from "./cache-state";
import { getTindioDatabase } from "./database";

function itemKey(item: Pick<PosCatalogItem, "productId" | "variantId">) {
  return `${item.productId}:${item.variantId ?? "simple"}`;
}

export async function saveCatalogPage(response: PosCatalogV2Response) {
  const capturedAt = new Date().toISOString();
  const database = await getTindioDatabase();

  await database.withExclusiveTransactionAsync(async (transaction) => {
    for (const item of response.items) {
      await transaction.runAsync(
        "INSERT INTO catalog_items (organization_id,store_id,item_key,product_id,variant_id,category_id,product_name,variant_name,sku,barcode,price_minor,unit,image_url,is_variable_price,allow_fractional_quantity,has_modifiers,payload_json,captured_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,store_id,item_key) DO UPDATE SET category_id=excluded.category_id,product_name=excluded.product_name,variant_name=excluded.variant_name,sku=excluded.sku,barcode=excluded.barcode,price_minor=excluded.price_minor,unit=excluded.unit,image_url=excluded.image_url,is_variable_price=excluded.is_variable_price,allow_fractional_quantity=excluded.allow_fractional_quantity,has_modifiers=excluded.has_modifiers,payload_json=excluded.payload_json,captured_at=excluded.captured_at",
        response.organizationId,
        response.storeId,
        itemKey(item),
        item.productId,
        item.variantId,
        item.categoryId,
        item.productName,
        item.variantName,
        item.sku,
        item.barcode,
        item.priceMinor,
        item.unit,
        item.imageUrl,
        item.isVariablePrice ? 1 : 0,
        item.allowFractionalQuantity ? 1 : 0,
        item.hasModifiers ? 1 : 0,
        JSON.stringify(item),
        capturedAt,
      );
    }
  });

  const count = await database.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM catalog_items WHERE organization_id = ? AND store_id = ?",
    response.organizationId,
    response.storeId,
  );
  await saveLocalCacheState({
    organizationId: response.organizationId,
    domain: "catalog",
    storeId: response.storeId,
    scopeKey: response.mode,
    sourceVersion: null,
    recordCount: count?.count ?? 0,
    isComplete: !response.hasMore && response.offset === 0,
    capturedAt,
  });
  return capturedAt;
}

export async function getCatalogItemCount(organizationId: string, storeId: string) {
  const row = await (await getTindioDatabase()).getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM catalog_items WHERE organization_id = ? AND store_id = ?",
    organizationId,
    storeId,
  );
  return row?.count ?? 0;
}

export async function replaceCompleteCatalogSnapshot(organizationId: string, storeId: string, items: PosCatalogItem[]) {
  const database = await getTindioDatabase();
  const capturedAt = new Date().toISOString();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync("DELETE FROM catalog_items WHERE organization_id = ? AND store_id = ?", organizationId, storeId);
    for (const item of items) await transaction.runAsync(
      "INSERT INTO catalog_items (organization_id,store_id,item_key,product_id,variant_id,category_id,product_name,variant_name,sku,barcode,price_minor,unit,image_url,is_variable_price,allow_fractional_quantity,has_modifiers,payload_json,captured_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      organizationId, storeId, itemKey(item), item.productId, item.variantId, item.categoryId, item.productName, item.variantName, item.sku, item.barcode, item.priceMinor, item.unit, item.imageUrl, item.isVariablePrice ? 1 : 0, item.allowFractionalQuantity ? 1 : 0, item.hasModifiers ? 1 : 0, JSON.stringify(item), capturedAt,
    );
  });
  await saveLocalCacheState({ organizationId, domain: "catalog", storeId, scopeKey: "offline-prime", sourceVersion: null, recordCount: items.length, isComplete: true, capturedAt });
  return { capturedAt, recordCount: items.length };
}
