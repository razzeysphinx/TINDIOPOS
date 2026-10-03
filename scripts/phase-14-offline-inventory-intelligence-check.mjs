import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("Phase 14 offline inventory intelligence implementation contract", () => {
  const model = fs.readFileSync(
    "apps/mobile/src/features/inventory/offline-inventory-intelligence.ts",
    "utf8",
  );
  const diagnostics = fs.readFileSync(
    "apps/mobile/src/features/inventory/offline-inventory-diagnostics.ts",
    "utf8",
  );
  const pos = fs.readFileSync(
    "apps/mobile/app/(app)/pos.tsx",
    "utf8",
  );
  const syncStatus = fs.readFileSync(
    "apps/mobile/app/(app)/sync-status.tsx",
    "utf8",
  );
  const outbox = fs.readFileSync(
    "apps/mobile/src/features/outbox/outbox-types.ts",
    "utf8",
  );
  const schema = fs.readFileSync(
    "apps/mobile/src/db/schema.ts",
    "utf8",
  );

  for (const marker of [
    "lastConfirmedCloudStock",
    "knownSyncedActivityFromThisTerminal",
    "deviceOnlyUnsyncedActivity",
    "estimatedAvailableStock",
    "baselineAgeMinutes",
    "projectedAfterCurrentCart",
    "projectedBelowZero",
    "CURRENT_DEVICE_ONLY",
    "ESTIMATE_ONLY",
  ]) {
    assert.ok(model.includes(marker), `model must include ${marker}`);
  }

  for (const marker of [
    "SERVER_LEDGER_AUTHORITATIVE",
    "baselineCount",
    "unresolvedSaleCount",
    "unresolvedAffectedSaleables",
  ]) {
    assert.ok(diagnostics.includes(marker), `diagnostics must include ${marker}`);
  }

  assert.ok(
    pos.includes("Other offline terminals are not represented here."),
    "POS must disclose the single-device limitation",
  );

  assert.ok(
    pos.includes("This value is not authoritative cloud stock."),
    "POS must not claim local estimate is authoritative",
  );

  assert.ok(
    syncStatus.includes("PHASE 14 OFFLINE INVENTORY INTELLIGENCE"),
    "Sync Status must expose Phase 14 diagnostics",
  );

  assert.ok(
    syncStatus.includes("Other offline devices are intentionally UNKNOWN"),
    "Sync Status must disclose unknown peer-device activity",
  );

  assert.equal(
    /export type OutboxOperationType\s*=\s*"SALE_COMPLETED"/.test(outbox),
    true,
    "Phase 14 must not expand the outbox operation set",
  );

  assert.ok(
    schema.includes("export const TINDIO_LOCAL_SCHEMA_VERSION = 6;"),
    "Phase 14 must not introduce an unnecessary local SQLite migration",
  );

  assert.doesNotMatch(
    model,
    /UPDATE\s+(stock_estimates|inventory|stock)/i,
    "read model must not mutate inventory",
  );

  assert.doesNotMatch(
    diagnostics,
    /UPDATE\s+(stock_estimates|inventory|stock)/i,
    "diagnostics must not mutate inventory",
  );
});
