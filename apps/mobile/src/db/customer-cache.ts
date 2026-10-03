import type {
  PosCustomer,
  PosCustomerSearchResponse,
} from "../../../../src/contracts/pos";
import { saveLocalCacheState } from "./cache-state";
import { getTindioDatabase } from "./database";

export async function saveCustomerSearchResults(
  organizationId: string,
  storeId: string,
  response: PosCustomerSearchResponse,
) {
  const capturedAt = new Date().toISOString();
  const database = await getTindioDatabase();

  await database.withExclusiveTransactionAsync(async (transaction) => {
    for (const customer of response.customers) {
      await transaction.runAsync(
        "INSERT INTO customer_cache (organization_id,store_id,customer_id,customer_number,loyalty_card_code,full_name,phone,email,loyalty_points,payload_json,captured_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,store_id,customer_id) DO UPDATE SET customer_number=excluded.customer_number,loyalty_card_code=excluded.loyalty_card_code,full_name=excluded.full_name,phone=excluded.phone,email=excluded.email,loyalty_points=excluded.loyalty_points,payload_json=excluded.payload_json,captured_at=excluded.captured_at",
        organizationId,
        storeId,
        customer.id,
        customer.customerNumber,
        customer.loyaltyCardCode,
        customer.fullName,
        customer.phone,
        customer.email,
        customer.loyaltyPoints,
        JSON.stringify(customer),
        capturedAt,
      );
    }
  });

  await saveLocalCacheState({
    organizationId,
    domain: "customers",
    storeId,
    scopeKey: "observed",
    sourceVersion: null,
    recordCount: response.customers.length,
    isComplete: false,
    capturedAt,
  });

  return capturedAt;
}

export async function searchCachedCustomers(
  organizationId: string,
  storeId: string,
  query: string,
  limit = 12,
) {
  const normalized = query.trim().toLocaleLowerCase();
  const rows = await (await getTindioDatabase()).getAllAsync<{ payload_json: string }>(
    "SELECT payload_json FROM customer_cache WHERE organization_id=? AND store_id=? AND (?='' OR lower(full_name) LIKE ? OR lower(coalesce(phone,'')) LIKE ? OR lower(coalesce(email,'')) LIKE ? OR cast(customer_number as text) LIKE ?) ORDER BY full_name COLLATE NOCASE LIMIT ?",
    organizationId,
    storeId,
    normalized,
    `%${normalized}%`,
    `%${normalized}%`,
    `%${normalized}%`,
    `%${normalized}%`,
    Math.min(Math.max(limit, 1), 50),
  );

  return rows.flatMap((row) => {
    try {
      return [JSON.parse(row.payload_json) as PosCustomer];
    } catch {
      return [];
    }
  });
}

export async function applyCustomerDelta(
  organizationId: string,
  storeId: string,
  customerId: string,
  customer: PosCustomer | null,
  capturedAt = new Date().toISOString(),
) {
  const database = await getTindioDatabase();

  await database.withExclusiveTransactionAsync(async (transaction) => {
    if (!customer) {
      await transaction.runAsync(
        "DELETE FROM customer_cache WHERE organization_id=? AND store_id=? AND customer_id=?",
        organizationId,
        storeId,
        customerId,
      );
      return;
    }

    await transaction.runAsync(
      "INSERT INTO customer_cache (organization_id,store_id,customer_id,customer_number,loyalty_card_code,full_name,phone,email,loyalty_points,payload_json,captured_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,store_id,customer_id) DO UPDATE SET customer_number=excluded.customer_number,loyalty_card_code=excluded.loyalty_card_code,full_name=excluded.full_name,phone=excluded.phone,email=excluded.email,loyalty_points=excluded.loyalty_points,payload_json=excluded.payload_json,captured_at=excluded.captured_at",
      organizationId,
      storeId,
      customer.id,
      customer.customerNumber,
      customer.loyaltyCardCode,
      customer.fullName,
      customer.phone,
      customer.email,
      customer.loyaltyPoints,
      JSON.stringify(customer),
      capturedAt,
    );
  });
}
