import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("Phase 14 Slice 02 cart inventory intelligence", () => {
  const model = fs.readFileSync(
    "apps/mobile/src/features/inventory/offline-inventory-intelligence.ts",
    "utf8",
  );
  const pos = fs.readFileSync(
    "apps/mobile/app/(app)/pos.tsx",
    "utf8",
  );
  const outbox = fs.readFileSync(
    "apps/mobile/src/features/outbox/outbox-types.ts",
    "utf8",
  );

  for (const marker of [
    "baselineAgeMinutes",
    "readCartOfflineInventoryIntelligence",
    "projectedAfterCurrentCart",
    "projectedBelowZero",
    "cartQuantity",
  ]) {
    assert.ok(model.includes(marker), `read model must include ${marker}`);
  }

  for (const marker of [
    "CURRENT DEVICE ONLY",
    "Other offline terminals are not represented here.",
    "Cloud baseline age:",
    "Projected after current cart:",
    "WARNING: this device estimate projects stock below zero.",
  ]) {
    assert.ok(pos.includes(marker), `POS must include ${marker}`);
  }

  assert.ok(
    pos.includes("readCartOfflineInventoryIntelligence"),
    "POS must refresh cart-wide inventory intelligence",
  );

  assert.equal(
    /export type OutboxOperationType\s*=\s*"SALE_COMPLETED"/.test(outbox),
    true,
    "Slice 02 must not expand the outbox operation set",
  );

  assert.doesNotMatch(
    model,
    /UPDATE\s+(stock_estimates|inventory|stock)/i,
    "inventory intelligence must remain read-only",
  );
});
