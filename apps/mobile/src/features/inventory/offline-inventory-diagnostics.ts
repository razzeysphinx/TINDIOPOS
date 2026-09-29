import { getTindioDatabase } from "../../db/database";

export type OfflineInventoryDiagnostics = {
  baselineCount: number;
  oldestBaselineAt: string | null;
  newestBaselineAt: string | null;
  unresolvedSaleCount: number;
  unresolvedAffectedSaleables: number;
  authority: "SERVER_LEDGER_AUTHORITATIVE";
  localScope: "CURRENT_DEVICE_ONLY";
};

type BaselineRow = {
  count: number;
  oldest: string | null;
  newest: string | null;
};

type OutboxRow = {
  payload_json: string;
};

function saleableKeys(payloadJson: string) {
  try {
    const payload = JSON.parse(payloadJson) as {
      checkout?: {
        items?: Array<{
          productId: string;
          variantId: string | null;
        }>;
      };
    };

    const items = payload.checkout?.items;

    if (!Array.isArray(items)) return [];

    return items
      .filter((item) => typeof item.productId === "string")
      .map((item) => `${item.productId}:${item.variantId ?? "simple"}`);
  } catch {
    return [];
  }
}

export async function getOfflineInventoryDiagnostics(input: {
  organizationId: string;
  storeId: string;
  deviceId: string;
}): Promise<OfflineInventoryDiagnostics> {
  const database = await getTindioDatabase();

  const baseline = await database.getFirstAsync<BaselineRow>(
    "SELECT COUNT(*) AS count, MIN(checked_at) AS oldest, MAX(checked_at) AS newest FROM stock_estimates WHERE organization_id=? AND store_id=?",
    input.organizationId,
    input.storeId,
  );

  const unresolved = await database.getAllAsync<OutboxRow>(
    "SELECT payload_json FROM outbox_events WHERE organization_id=? AND store_id=? AND device_id=? AND operation_type='SALE_COMPLETED' AND state<>'SYNCED'",
    input.organizationId,
    input.storeId,
    input.deviceId,
  );

  const affected = new Set<string>();

  for (const row of unresolved) {
    for (const key of saleableKeys(row.payload_json)) {
      affected.add(key);
    }
  }

  return {
    baselineCount: baseline?.count ?? 0,
    oldestBaselineAt: baseline?.oldest ?? null,
    newestBaselineAt: baseline?.newest ?? null,
    unresolvedSaleCount: unresolved.length,
    unresolvedAffectedSaleables: affected.size,
    authority: "SERVER_LEDGER_AUTHORITATIVE",
    localScope: "CURRENT_DEVICE_ONLY",
  };
}
