import { getTindioDatabase } from "./database";
// outbox_events, device_sync_state, and sync_cursors are intentionally excluded: cache cleanup must never erase accepted sales, reset sequencing, or lose reconciliation progress.
const ORGANIZATION_TABLES = ["business_context_snapshots", "local_cache_state", "reference_snapshots", "catalog_items", "customer_cache", "shift_snapshots", "receipt_summaries"] as const;

export async function clearOrganizationLocalCache(organizationId: string) {
  const database = await getTindioDatabase();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    for (const table of ORGANIZATION_TABLES) {
      await transaction.runAsync(`DELETE FROM ${table} WHERE organization_id = ?`, organizationId);
    }
  });
}
