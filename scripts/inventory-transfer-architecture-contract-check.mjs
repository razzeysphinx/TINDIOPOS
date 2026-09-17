import assert from "node:assert/strict";

import {
  readFile,
} from "node:fs/promises";

import test from "node:test";

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

const [
  design,
  operationIntegrityMigration,
  directTransferMigration,
  granularRbacMigration,
  supplyChainActions,
  advancedActions,
  transferWorkspace,
  posIncomingInbox,
  transferIntegrityTest,
] =
  await Promise.all([
    source(
      "../docs/TINDIO_INVENTORY_TRANSFER_LIFECYCLE_DESIGN.md",
    ),

    source(
      "../supabase/migrations/20260906074121_transfer_lifecycle_operation_integrity.sql",
    ),

    source(
      "../supabase/migrations/20260910140907_direct_store_transfer_lifecycle.sql",
    ),

    source(
      "../supabase/migrations/20260910142940_granular_inventory_transfer_rbac.sql",
    ),

    source(
      "../src/features/inventory/supply-chain-actions.ts",
    ),

    source(
      "../src/features/inventory/advanced-inventory-actions.ts",
    ),

    source(
      "../src/features/inventory/inventory-transfer-workspace.tsx",
    ),

    source(
      "../src/features/pos/pos-incoming-transfer-inbox.tsx",
    ),

    source(
      "../supabase/tests/database/transfer_lifecycle_operation_integrity.test.sql",
    ),
  ]);

test(
  "current direct-store transfer collapses create and dispatch but keeps destination receipt separate",
  () => {
    assert.match(
      transferWorkspace,
      /transferStockAction/,
    );

    assert.match(
      transferWorkspace,
      /Source stock leaves immediately; destination stock changes only when the receiving store confirms it\./,
    );

    assert.match(
      advancedActions,
      /supabase\.rpc\("create_direct_stock_transfer"/,
    );

    assert.match(
      advancedActions,
      /supabase\.rpc\("receive_stock_transfer"/,
    );

    assert.match(
      directTransferMigration,
      /'in_transit'/,
    );

    assert.match(
      directTransferMigration,
      /'TRANSFER_OUT'/,
    );

    assert.match(
      directTransferMigration,
      /create or replace function private\.receive_stock_transfer/,
    );
  },
);

test(
  "current replenishment flow remains a separate request lifecycle",
  () => {
    for (
      const rpcName
      of [
        "create_stock_request",
        "approve_stock_request",
        "start_stock_request_picking",
        "dispatch_stock_request",
        "receive_stock_request",
      ]
    ) {
      assert.match(
        supplyChainActions,
        new RegExp(
          `supabase\\.rpc\\("${rpcName}"`,
        ),
      );
    }

    assert.match(
      operationIntegrityMigration,
      /Requests plan stock only; dispatch\/receipt remain the sole inventory-changing/,
    );
  },
);

test(
  "current POS receipt surface branches between request-linked and direct receipts",
  () => {
    assert.match(
      posIncomingInbox,
      /selectedTransfer\.stockRequestId/,
    );

    assert.match(
      posIncomingInbox,
      /receiveStockRequestAction/,
    );

    assert.match(
      posIncomingInbox,
      /receiveStockTransferAction/,
    );
  },
);

test(
  "repository still contains the overlapping legacy immediate transfer command",
  () => {
    assert.match(
      granularRbacMigration,
      /create or replace function private\.transfer_stock/,
    );

    assert.match(
      granularRbacMigration,
      /'TRANSFER_OUT'/,
    );

    assert.match(
      granularRbacMigration,
      /'TRANSFER_IN'/,
    );

    assert.match(
      directTransferMigration,
      /create or replace function private\.create_direct_stock_transfer/,
    );

    assert.match(
      operationIntegrityMigration,
      /create function private\.dispatch_stock_request/,
    );
  },
);

test(
  "existing integrity coverage preserves stock-neutral planning, source dispatch, and destination receipt",
  () => {
    assert.match(
      transferIntegrityTest,
      /planning a request leaves source stock unchanged/,
    );

    assert.match(
      transferIntegrityTest,
      /dispatch reduces source stock exactly once/,
    );

    assert.match(
      transferIntegrityTest,
      /dispatch does not increase destination stock/,
    );

    assert.match(
      transferIntegrityTest,
      /destination receives only the physical quantity once/,
    );

    assert.match(
      transferIntegrityTest,
      /generic receipt cannot bypass request shortage tracking/,
    );
  },
);

test(
  "target architecture declares the complete canonical lifecycle and only pre-dispatch cancellation",
  () => {
    for (
      const state
      of [
        "draft",
        "submitted",
        "approved",
        "dispatched",
        "partially_received",
        "received",
        "cancelled",
      ]
    ) {
      assert.match(
        design,
        new RegExp(
          `\\b${state}\\b`,
        ),
      );
    }

    assert.match(
      design,
      /Cancellation is legal only before dispatch/,
    );

    assert.match(
      design,
      /cannot transition to `cancelled`/,
    );
  },
);

test(
  "architecture separates canonical states from legacy transfer-status compatibility",
  () => {
    assert.match(
      directTransferMigration,
      /'in_transit'/,
    );

    assert.match(
      granularRbacMigration,
      /then\s+'completed'\s+else\s+'partially_received'/,
    );

    assert.match(
      design,
      /Temporary legacy database compatibility states/,
    );

    assert.match(
      design,
      /in_transit[\s\S]*completed/,
    );

    assert.match(
      design,
      /compatibility values, not canonical lifecycle states/i,
    );

    assert.match(
      design,
      /stock_request_id IS NULL[\s\S]*status = in_transit[\s\S]*dispatched/,
    );

    assert.match(
      design,
      /stock_request_id IS NOT NULL[\s\S]*status IN \(in_transit, partially_received, completed\)/,
    );

    assert.match(
      design,
      /New canonical commands must never create `in_transit` or `completed`/,
    );

    assert.match(
      design,
      /removed only after every legacy writer[\s\S]*has been migrated/i,
    );
  },
);

test(
  "target architecture fixes stock effects, partial receipt accounting, and permission ownership",
  () => {
    assert.match(
      design,
      /source stock changes only at dispatch/,
    );

    assert.match(
      design,
      /destination stock changes only at receipt/,
    );

    assert.match(
      design,
      /sum\(received_quantity\)[\s\S]*sum\(short_quantity\)/,
    );

    assert.match(
      design,
      /short quantity[\s\S]*does not automatically restore source stock/i,
    );

    for (
      const capability
      of [
        "inventory.transfer.create",
        "inventory.transfer.send",
        "inventory.transfer.receive",
      ]
    ) {
      assert.match(
        design,
        new RegExp(
          capability.replaceAll(
            ".",
            "\\.",
          ),
        ),
      );
    }
  },
);

test(
  "target architecture defines canonical commands, compatibility adapters, and the Phase 05 slice",
  () => {
    for (
      const command
      of [
        "create_inventory_transfer_draft",
        "submit_inventory_transfer",
        "approve_inventory_transfer",
        "dispatch_inventory_transfer",
        "receive_inventory_transfer",
        "cancel_inventory_transfer",
      ]
    ) {
      assert.match(
        design,
        new RegExp(
          command,
        ),
      );
    }

    assert.match(
      design,
      /create_direct_stock_transfer[\s\S]*canonical create[\s\S]*canonical submit[\s\S]*canonical approve[\s\S]*canonical dispatch/,
    );

    assert.match(
      design,
      /receive_stock_transfer[\s\S]*canonical receive_inventory_transfer/,
    );

    assert.match(
      design,
      /Phase 05 is deliberately narrow/,
    );

    assert.match(
      design,
      /should \*\*not yet\*\* migrate the replenishment stock-request workflow/,
    );
  },
);

test(
  "target architecture preserves ledger authority, deterministic locks, and stable operation identities",
  () => {
    assert.match(
      design,
      /inventory_movements/,
    );

    assert.match(
      design,
      /inventory_levels/,
    );

    assert.match(
      design,
      /Always lock:[\s\S]*stock_transfers row/,
    );

    assert.match(
      design,
      /product_id[\s\S]*variant_id/,
    );

    assert.match(
      design,
      /Every mutating lifecycle command requires a stable client operation ID/,
    );

    assert.match(
      design,
      /unique \(organization_id, operation_id\)/,
    );

    assert.match(
      design,
      /same operation ID[\s\S]*same command[\s\S]*same normalized payload[\s\S]*return original result/,
    );
  },
);

test("design v1.2 records the Phase 05 post-merge operation and reader contracts", () => {
  assert.match(design, /Design version:\*\* 1\.2/);
  assert.match(design, /external operation ID[\s\S]*canonical create-transition identity/i);
  assert.match(design, /submit[\s\S]*approve[\s\S]*dispatch[\s\S]*deterministic/i);
  assert.match(design, /Random child IDs are forbidden/i);
  assert.match(design, /receiving readers share one transitional reader contract/i);
});
