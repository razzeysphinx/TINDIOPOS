import { saveCatalogPage } from "../../db/catalog-cache";
import { saveCustomerSearchResults } from "../../db/customer-cache";
import { saveReceiptSummaries } from "../../db/receipt-cache";
import { saveReferenceSnapshot } from "../../db/reference-cache";
import { fetchPosV2CatalogPage, fetchPosV2Customers, fetchPosV2Receipts, fetchPosV2Reference } from "../../lib/tindio-api";

export async function refreshReferenceCache(organizationId: string) {
  const response = await fetchPosV2Reference(organizationId);
  await saveReferenceSnapshot(response);
  return response;
}
export async function fetchAndCacheCatalogPage(organizationId: string, storeId: string, options?: Parameters<typeof fetchPosV2CatalogPage>[2]) {
  const response = await fetchPosV2CatalogPage(organizationId, storeId, options);
  await saveCatalogPage(response);
  return response;
}
export async function fetchAndCacheCustomers(organizationId: string, storeId: string, query?: string) {
  const response = await fetchPosV2Customers(organizationId, storeId, query);
  await saveCustomerSearchResults(organizationId, storeId, response);
  return response;
}
export async function fetchAndCacheReceipts(organizationId: string, options?: Parameters<typeof fetchPosV2Receipts>[1]) {
  const response = await fetchPosV2Receipts(organizationId, options);
  await saveReceiptSummaries(organizationId, response);
  return response;
}
