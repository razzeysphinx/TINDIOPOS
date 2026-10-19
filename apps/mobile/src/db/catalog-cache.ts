import type { PosCatalogItem, PosCatalogV2Response } from "@tindio/contracts";
import { saveLocalCacheState } from "./cache-state";
import { getTindioDatabase } from "./database";

export const CATALOG_ITEM_UPSERT_SQL = `
  INSERT INTO catalog_items (
    organization_id, store_id, item_key, product_id, variant_id, category_id,
    product_name, variant_name, sku, barcode, price_minor, unit, image_url,
    is_variable_price, allow_fractional_quantity, has_modifiers,
    payload_json, captured_at, search_text
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(organization_id, store_id, item_key) DO UPDATE SET
    product_id=excluded.product_id,
    variant_id=excluded.variant_id,
    category_id=excluded.category_id,
    product_name=excluded.product_name,
    variant_name=excluded.variant_name,
    sku=excluded.sku,
    barcode=excluded.barcode,
    price_minor=excluded.price_minor,
    unit=excluded.unit,
    image_url=excluded.image_url,
    is_variable_price=excluded.is_variable_price,
    allow_fractional_quantity=excluded.allow_fractional_quantity,
    has_modifiers=excluded.has_modifiers,
    payload_json=excluded.payload_json,
    captured_at=excluded.captured_at,
    search_text=excluded.search_text
`;

export function catalogItemKey(item: Pick<PosCatalogItem, "productId" | "variantId">) {
  return `${item.productId}:${item.variantId ?? "simple"}`;
}

export function catalogSearchableText(item: PosCatalogItem) {
  return [item.productName, item.variantName, item.sku, item.barcode]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .trim()
    .toLocaleLowerCase();
}

export async function writeCatalogItem(
  database: Awaited<ReturnType<typeof getTindioDatabase>>,
  item: PosCatalogItem,
  organizationId: string,
  storeId: string,
  capturedAt: string,
) {
  await database.runAsync(
    CATALOG_ITEM_UPSERT_SQL,
    organizationId,
    storeId,
    catalogItemKey(item),
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
    catalogSearchableText(item),
  );
}
export async function saveCatalogPage(response: PosCatalogV2Response) { const capturedAt = new Date().toISOString(); const database = await getTindioDatabase(); await database.withExclusiveTransactionAsync(async (tx) => { for (const item of response.items) await writeCatalogItem(tx as never,item,response.organizationId,response.storeId,capturedAt); }); const count = await getCatalogItemCount(response.organizationId,response.storeId); await saveLocalCacheState({organizationId:response.organizationId,domain:"catalog",storeId:response.storeId,scopeKey:response.mode,sourceVersion:null,recordCount:count,isComplete:!response.hasMore&&response.offset===0,capturedAt}); return capturedAt; }
export async function getCatalogItemCount(organizationId:string,storeId:string) { const row=await (await getTindioDatabase()).getFirstAsync<{count:number}>("SELECT COUNT(*) AS count FROM catalog_items WHERE organization_id = ? AND store_id = ?",organizationId,storeId); return row?.count??0; }
export async function replaceCompleteCatalogSnapshot(organizationId:string,storeId:string,items:PosCatalogItem[]) { const database=await getTindioDatabase(); const capturedAt=new Date().toISOString(); await database.withExclusiveTransactionAsync(async(tx)=>{await tx.runAsync("DELETE FROM catalog_items WHERE organization_id = ? AND store_id = ?",organizationId,storeId); for(const item of items) await writeCatalogItem(tx as never,item,organizationId,storeId,capturedAt);}); await saveLocalCacheState({organizationId,domain:"catalog",storeId,scopeKey:"offline-prime",sourceVersion:null,recordCount:items.length,isComplete:true,capturedAt}); return {capturedAt,recordCount:items.length}; }
export async function replaceCatalogProductDelta(organizationId:string,storeId:string,productId:string,items:PosCatalogItem[],capturedAt=new Date().toISOString()){const database=await getTindioDatabase();await database.withExclusiveTransactionAsync(async(tx)=>{await tx.runAsync("DELETE FROM catalog_items WHERE organization_id=? AND store_id=? AND product_id=?",organizationId,storeId,productId);for(const item of items)await writeCatalogItem(tx as never,item,organizationId,storeId,capturedAt);});}
