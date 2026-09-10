import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

test("controlled adjustments use one approval-aware, idempotent command", async () => {
  const [migration, correction] = await Promise.all([
    source("supabase/migrations/20260906125656_controlled_inventory_adjustments.sql"),
    source("supabase/migrations/20260906131442_fix_controlled_adjustment_number_variable.sql"),
  ]);

  assert.match(migration, /create or replace function private\.record_inventory_adjustment\(/);
  assert.match(migration, /private\.authorize_sensitive_operation\(/);
  assert.match(migration, /private\.inventory_actor\(/);
  assert.match(migration, /unique \(organization_id, operation_id\)/);
  assert.match(migration, /Provide an adjustment explanation between 2 and 500 characters/);
  assert.match(migration, /Opening stock can only be recorded once/);
  assert.match(migration, /private\.record_inventory_adjustment_v2\(uuid,uuid,uuid,uuid,numeric,text,text\),/);
  assert.match(migration, /CANDIDATE_FOR_REMOVAL: superseded by public\.record_inventory_adjustment/);
  assert.match(correction, /created_adjustment_number bigint/);
  assert.match(correction, /returning id, adjustment_number into adjustment_id, created_adjustment_number/);
});

test("the adjustment interface requires a review, explanation, and scoped capability", async () => {
  const [page, navigation, workflows, actions] = await Promise.all([
    source("src/app/(back-office)/back-office/inventory/page.tsx"),
    source("src/features/inventory/inventory-workspace-navigation.tsx"),
    source("src/features/inventory/inventory-integrity-workflows.tsx"),
    source("src/features/inventory/advanced-inventory-actions.ts"),
  ]);

  assert.match(page, /hasPermission\(context, "inventory\.adjust"\) \|\| canManage/);
  assert.match(page, /activeTab === "adjustments" && canAdjust/);
  assert.match(navigation, /canAdjust/);
  assert.match(workflows, />Review adjustment</);
  assert.match(workflows, /Required: explain why stock is changing/);
  assert.match(workflows, /ManagerApprovalDialog/);
  assert.match(actions, /requireInventoryAdjuster/);
  assert.match(actions, /rpc\("record_inventory_adjustment"/);
});

test("CSV adjustment retries use the shared payload-specific operation identity", async () => {
  const [workflow, operationId] = await Promise.all([
    source("src/features/inventory/advanced-inventory-workflows.tsx"),
    source("src/features/inventory/inventory-operation-id.ts"),
  ]);

  assert.match(workflow, /getInventoryOperationId as pendingOperationId/);
  assert.match(operationId, /export function getInventoryOperationId\(scope: string, payload\?: unknown\)/);
  assert.match(operationId, /stored\.fingerprint === fingerprint/);
  assert.match(workflow, /CSV inventory adjustment import/);
  assert.match(workflow, /Each CSV row must include a specific 2/);
  assert.match(workflow, /operation_id: operationId/);
  assert.match(workflow, /setAdjustmentApprovalRequestId\(null\)/);
});
