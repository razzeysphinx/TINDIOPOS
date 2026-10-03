import {
  getTindioDatabase,
} from "../../db/database";

export type LocalTenantIsolationCounts = {
  organizationId: string;
  products: number;
  customers: number;
  receipts: number;
  inventory: number;
  events: number;
  configuration: number;
};

type CountRow = {
  count: number;
};

async function count(
  sql: string,
  organizationId: string,
) {
  const row =
    await (
      await getTindioDatabase()
    ).getFirstAsync<CountRow>(
      sql,
      organizationId,
    );

  return row?.count ?? 0;
}

export async function getLocalTenantIsolationCounts(
  organizationId: string,
): Promise<LocalTenantIsolationCounts> {
  const [
    products,
    customers,
    receipts,
    stockEstimates,
    storeHubEvents,
    outboxEvents,
    businessContext,
    referenceSnapshots,
    localCacheState,
  ] = await Promise.all([
    count(
      "SELECT COUNT(*) AS count FROM catalog_items WHERE organization_id=?",
      organizationId,
    ),
    count(
      "SELECT COUNT(*) AS count FROM customer_cache WHERE organization_id=?",
      organizationId,
    ),
    count(
      "SELECT COUNT(*) AS count FROM receipt_summaries WHERE organization_id=?",
      organizationId,
    ),
    count(
      "SELECT COUNT(*) AS count FROM stock_estimates WHERE organization_id=?",
      organizationId,
    ),
    count(
      "SELECT COUNT(*) AS count FROM store_hub_events WHERE organization_id=?",
      organizationId,
    ),
    count(
      "SELECT COUNT(*) AS count FROM outbox_events WHERE organization_id=?",
      organizationId,
    ),
    count(
      "SELECT COUNT(*) AS count FROM business_context_snapshots WHERE organization_id=?",
      organizationId,
    ),
    count(
      "SELECT COUNT(*) AS count FROM reference_snapshots WHERE organization_id=?",
      organizationId,
    ),
    count(
      "SELECT COUNT(*) AS count FROM local_cache_state WHERE organization_id=?",
      organizationId,
    ),
  ]);

  return {
    organizationId,
    products,
    customers,
    receipts,
    inventory:
      stockEstimates
      + storeHubEvents,
    events:
      outboxEvents,
    configuration:
      businessContext
      + referenceSnapshots
      + localCacheState,
  };
}