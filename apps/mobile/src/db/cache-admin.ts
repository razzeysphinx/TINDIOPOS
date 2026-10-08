import { getTindioDatabase } from "./database";
// checkout_intents, outbox_events, local_receipts, receipt_copy_jobs, device_sync_state, sync_cursors, and shift_finalization_guards are intentionally excluded: cache cleanup must never erase accepted/unknown sales, receipt custody/history, reset sequencing, lose reconciliation progress, or remove an in-flight close barrier.
const ORGANIZATION_TABLES = ["business_context_snapshots", "local_cache_state", "reference_snapshots", "catalog_items", "customer_cache", "shift_snapshots", "receipt_summaries"] as const;

export async function clearOrganizationLocalCache(organizationId: string) {
  const database = await getTindioDatabase();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    for (const table of ORGANIZATION_TABLES) {
      await transaction.runAsync(`DELETE FROM ${table} WHERE organization_id = ?`, organizationId);
    }
  });
}
