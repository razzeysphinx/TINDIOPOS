import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const intelligencePath =
  "apps/mobile/src/features/inventory/offline-inventory-intelligence.ts";

const posPath =
  "apps/mobile/app/(app)/pos.tsx";

test("Phase 14 Slice 01 inventory intelligence contract", () => {
  assert.ok(
    fs.existsSync(intelligencePath),
    "inventory intelligence read model must exist",
  );

  const intelligence = fs.readFileSync(intelligencePath, "utf8");
  const pos = fs.readFileSync(posPath, "utf8");
  const outboxTypes = fs.readFileSync(
    "apps/mobile/src/features/outbox/outbox-types.ts",
    "utf8",
  );

  for (const marker of [
    "lastConfirmedCloudStock",
    "knownSyncedActivityFromThisTerminal",
    "deviceOnlyUnsyncedActivity",
    "estimatedAvailableStock",
    "CURRENT_DEVICE_ONLY",
    "ESTIMATE_ONLY",
    "SALE_COMPLETED",
  ]) {
    assert.ok(
      intelligence.includes(marker),
      `inventory intelligence must include ${marker}`,
    );
  }

  assert.ok(
    intelligence.includes('row.state === "SYNCED"'),
    "synced activity must be distinguished from unresolved device-only activity",
  );

  assert.ok(
    intelligence.includes("row.synced_at > baseline.checked_at"),
    "synced device activity must only adjust a cloud baseline when it happened after that baseline",
  );

  assert.ok(
    pos.includes("INVENTORY INTELLIGENCE â€” ESTIMATE ONLY"),
    "POS must clearly label inventory intelligence as an estimate",
  );

  assert.ok(
    pos.includes("This value is not authoritative cloud stock."),
    "POS must not present local inventory estimate as authoritative",
  );

  assert.ok(
    pos.includes("refreshCartStockEstimates"),
    "online selection should refresh the server-confirmed stock baseline when available",
  );

  assert.ok(
    pos.includes("readOfflineInventoryIntelligence"),
    "POS must use the Phase 14 read model",
  );

  assert.doesNotMatch(
    intelligence,
    /UPDATE\s+stock_estimates/i,
    "Phase 14 intelligence read model must not mutate cached authoritative baseline rows",
  );

  assert.equal(
    /export type OutboxOperationType\s*=\s*"SALE_COMPLETED"/.test(outboxTypes),
    true,
    "Phase 14 Slice 01 must not expand the durable outbox operation set",
  );
});
