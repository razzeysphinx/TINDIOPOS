import assert from "node:assert/strict";

import {
  readFile,
} from "node:fs/promises";

import test from "node:test";

import {
  reconcileInventoryState,
} from "./lib/inventory-reconciliation.mjs";

const source =
  (
    relativePath,
  ) =>
    readFile(
      new URL(
        relativePath,
        import.meta.url,
      ),
      "utf8",
    );

const validLevels = [
  {
    organization_id:
      "org-1",
    store_id:
      "store-1",
    product_id:
      "product-1",
    variant_id:
      null,
    quantity:
      7,
  },
];

const validMovements = [
  {
    id:
      "movement-1",
    organization_id:
      "org-1",
    store_id:
      "store-1",
    product_id:
      "product-1",
    variant_id:
      null,
    quantity_before:
      0,
    quantity_delta:
      10,
    quantity_after:
      10,
    created_at:
      "2026-01-01T00:00:00.000Z",
  },
  {
    id:
      "movement-2",
    organization_id:
      "org-1",
    store_id:
      "store-1",
    product_id:
      "product-1",
    variant_id:
      null,
    quantity_before:
      10,
    quantity_delta:
      -3,
    quantity_after:
      7,
    created_at:
      "2026-01-01T00:00:01.000Z",
  },
];

test(
  "reconciliation accepts a continuous ledger whose latest quantity equals the projection",
  () => {
    const result =
      reconcileInventoryState({
        levels:
          validLevels,

        movements:
          validMovements,
      });

    assert.equal(
      result.ok,
      true,
    );

    assert.equal(
      result.anomalyCount,
      0,
    );

    assert.equal(
      result.projectionKeyCount,
      1,
    );

    assert.equal(
      result.ledgerKeyCount,
      1,
    );
  },
);

test(
  "reconciliation detects movement arithmetic corruption",
  () => {
    const result =
      reconcileInventoryState({
        levels:
          validLevels,

        movements: [
          {
            ...validMovements[0],
            quantity_after:
              9,
          },
        ],
      });

    assert.equal(
      result.ok,
      false,
    );

    assert.equal(
      result.anomalyCounts
        .movement_arithmetic_mismatch,
      1,
    );
  },
);

test(
  "reconciliation detects a broken before/after ledger chain",
  () => {
    const result =
      reconcileInventoryState({
        levels:
          validLevels,

        movements: [
          validMovements[0],
          {
            ...validMovements[1],
            quantity_before:
              9,
            quantity_delta:
              -2,
          },
        ],
      });

    assert.equal(
      result.ok,
      false,
    );

    assert.equal(
      result.anomalyCounts
        .ledger_chain_break,
      1,
    );
  },
);

test(
  "reconciliation detects projection drift from the latest movement",
  () => {
    const result =
      reconcileInventoryState({
        levels: [
          {
            ...validLevels[0],
            quantity:
              6,
          },
        ],

        movements:
          validMovements,
      });

    assert.equal(
      result.ok,
      false,
    );

    assert.equal(
      result.anomalyCounts
        .projection_ledger_mismatch,
      1,
    );
  },
);

test(
  "reconciliation rejects non-zero projected stock without ledger evidence",
  () => {
    const result =
      reconcileInventoryState({
        levels:
          validLevels,

        movements:
          [],
      });

    assert.equal(
      result.ok,
      false,
    );

    assert.equal(
      result.anomalyCounts
        .nonzero_projection_without_ledger,
      1,
    );
  },
);

test(
  "zero projections may exist before the first stock movement",
  () => {
    const result =
      reconcileInventoryState({
        levels: [
          {
            ...validLevels[0],
            quantity:
              0,
          },
        ],

        movements:
          [],
      });

    assert.equal(
      result.ok,
      true,
    );
  },
);

test(
  "runtime certification uses simultaneous authenticated adjustment calls and global reconciliation",
  async () => {
    const runtime =
      await source(
        "./inventory-reconciliation-concurrency-certification.mjs",
      );

    assert.match(
      runtime,
      /Promise\.allSettled/,
    );

    assert.match(
      runtime,
      /record_inventory_adjustment_v3/,
    );

    assert.match(
      runtime,
      /createClient/,
    );

    assert.match(
      runtime,
      /reconcileInventoryState/,
    );

    assert.match(
      runtime,
      /SERVICE_ROLE_KEY/,
    );

    assert.match(
      runtime,
      /ANON_KEY/,
    );

    assert.match(
      runtime,
      /parseAndValidateLocalSupabaseStatus/,
    );

    assert.match(
      runtime,
      /default_transaction_read_only=on/,
    );

    assert.match(
      runtime,
      /supabase_db_tindio_pos/i,
    );

    assert.match(
      runtime,
      /localReadOnlySql/,
    );

    assert.doesNotMatch(
      runtime,
      /\.from\s*\(\s*["'`](?:inventory_levels|inventory_movements|inventory_adjustments)["'`]\s*\)/,
    );
  },
);

test(
  "database certification executes the runtime evidence harness after the pgTAP suite",
  async () => {
    const certification =
      await source(
        "./certify-repository.mjs",
      );

    const pgTapIndex =
      certification.indexOf(
        "Complete local pgTAP suite",
      );

    const concurrencyIndex =
      certification.indexOf(
        "Inventory reconciliation and concurrency evidence",
      );

    assert.ok(
      pgTapIndex
        >= 0,
    );

    assert.ok(
      concurrencyIndex
        > pgTapIndex,
    );

    assert.match(
      certification,
      /inventory-reconciliation-concurrency-certification\.mjs/,
    );
  },
);
