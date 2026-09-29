import { getTindioDatabase } from "./database";

export type OrganizationCacheStats = {
  businessContext: number;
  reference: number;
  catalog: number;
  customers: number;
  shifts: number;
  receipts: number;
};

async function count(table: string, organizationId: string) {
  const row = await (await getTindioDatabase()).getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM ${table} WHERE organization_id = ?`,
    organizationId,
  );
  return row?.count ?? 0;
}

export async function getOrganizationCacheStats(organizationId: string): Promise<OrganizationCacheStats> {
  const [businessContext, reference, catalog, customers, shifts, receipts] = await Promise.all([
    count("business_context_snapshots", organizationId),
    count("reference_snapshots", organizationId),
    count("catalog_items", organizationId),
    count("customer_cache", organizationId),
    count("shift_snapshots", organizationId),
    count("receipt_summaries", organizationId),
  ]);
  return { businessContext, reference, catalog, customers, shifts, receipts };
}
