import type { PosSyncResnapshotResponse } from "@tindio/contracts";
import { writeCatalogItem } from "./catalog-cache";
import { getTindioDatabase } from "./database";

export const RESNAPSHOT_DELETE_CATALOG_SQL = "DELETE FROM catalog_items WHERE organization_id=? AND store_id=?";
export const RESNAPSHOT_DELETE_CUSTOMERS_SQL = "DELETE FROM customer_cache WHERE organization_id=? AND store_id=?";
export const RESNAPSHOT_DELETE_MODIFIERS_SQL = "DELETE FROM modifier_snapshots WHERE organization_id=? AND store_id=?";
export const RESNAPSHOT_REFERENCE_SQL = "INSERT INTO reference_snapshots (organization_id,reference_version,payload_json,captured_at) VALUES (?,?,?,?) ON CONFLICT(organization_id) DO UPDATE SET reference_version=excluded.reference_version,payload_json=excluded.payload_json,captured_at=excluded.captured_at";
export const RESNAPSHOT_CACHE_STATE_SQL = "INSERT INTO local_cache_state (organization_id,domain,store_id,scope_key,source_version,record_count,is_complete,captured_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,domain,store_id,scope_key) DO UPDATE SET source_version=excluded.source_version,record_count=excluded.record_count,is_complete=excluded.is_complete,captured_at=excluded.captured_at";
export const RESNAPSHOT_CURSOR_SQL = "UPDATE sync_cursors SET pull_cursor=MAX(pull_cursor,?),initialized=1,last_pull_at=?,last_error=NULL WHERE organization_id=? AND device_id=? AND store_id=?";

export async function applySyncResnapshot(snapshot: PosSyncResnapshotResponse) {
  const database = await getTindioDatabase();
  const capturedAt = new Date().toISOString();

  await database.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync(RESNAPSHOT_DELETE_CATALOG_SQL, snapshot.organizationId, snapshot.storeId);
    for (const item of snapshot.catalog) {
      await writeCatalogItem(tx as never, item, snapshot.organizationId, snapshot.storeId, capturedAt);
    }
    if (snapshot.clearObservedCustomers) {
      await tx.runAsync(RESNAPSHOT_DELETE_CUSTOMERS_SQL, snapshot.organizationId, snapshot.storeId);
    }
    if (snapshot.invalidateModifiers) {
      await tx.runAsync(RESNAPSHOT_DELETE_MODIFIERS_SQL, snapshot.organizationId, snapshot.storeId);
    }
    await tx.runAsync(
      RESNAPSHOT_REFERENCE_SQL,
      snapshot.organizationId,
      snapshot.reference.referenceVersion,
      JSON.stringify(snapshot.reference.reference),
      capturedAt,
    );
    await tx.runAsync(RESNAPSHOT_CACHE_STATE_SQL, snapshot.organizationId, "catalog", snapshot.storeId, "offline-prime", String(snapshot.serverRevision), snapshot.catalog.length, 1, capturedAt);
    await tx.runAsync(RESNAPSHOT_CACHE_STATE_SQL, snapshot.organizationId, "reference", "", "default", snapshot.reference.referenceVersion, 1, 1, capturedAt);
    await tx.runAsync(RESNAPSHOT_CACHE_STATE_SQL, snapshot.organizationId, "customers", snapshot.storeId, "observed", String(snapshot.serverRevision), 0, 0, capturedAt);

    // Cursor advancement is deliberately last: any prior failure rolls the whole replacement back.
    await tx.runAsync(RESNAPSHOT_CURSOR_SQL, snapshot.serverRevision, capturedAt, snapshot.organizationId, snapshot.deviceId, snapshot.storeId);
  });

  return { capturedAt, catalog: snapshot.catalog.length };
}
