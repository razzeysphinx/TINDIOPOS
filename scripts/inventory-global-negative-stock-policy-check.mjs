import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

const [migration, rpcGrantMigration, actions, workspace, page, preflightTest] = await Promise.all([
  source("supabase/migrations/20260905153055_inventory_global_negative_stock_policy.sql"),
  source("supabase/migrations/20260905154220_inventory_global_negative_stock_policy_rpc_grants.sql"),
  source("src/features/inventory/advanced-inventory-actions.ts"),
  source("src/features/inventory/inventory-integrity-workflows.tsx"),
  source("src/app/(back-office)/back-office/inventory/page.tsx"),
  source("supabase/tests/database/pos_negative_stock_preflight.test.sql"),
]);

test("one organization default is combined with optional per-store overrides", () => {
  assert.match(migration, /create table public\.inventory_policy_defaults/);
  assert.match(migration, /organization_id uuid primary key/);
  assert.match(migration, /private\.resolve_negative_stock_policy/);
  assert.match(migration, /Store Override|store override/i);
  assert.match(migration, /organization default/i);
  assert.doesNotMatch(migration, /insert into public\.inventory_policies[\s\S]{0,200}from public\.stores/i);
});

test("every existing checkout safeguard resolves the same effective policy", () => {
  assert.match(migration, /create or replace function private\.enforce_negative_stock_policy/);
  assert.match(migration, /create or replace function private\.validate_pos_cart_stock/);
  assert.match(migration, /create or replace function private\.get_checkout_stock_warning\([\s\S]*?target_sale_id uuid/);
  assert.match(migration, /resolved_policy := private\.resolve_negative_stock_policy/);
  assert.match(migration, /if private\.resolve_negative_stock_policy\(target_organization_id, target_store_id\) <> 'warn'/);
});

test("default and override mutations remain permission-checked and audited", () => {
  assert.match(migration, /private\.has_permission\(target_organization_id, 'inventory\.manage'\)/);
  assert.match(migration, /private\.has_permission\(target_organization_id, 'stores\.manage'\)/);
  assert.match(migration, /private\.has_store_read_scope\(target_organization_id, target_store_id\)/);
  assert.match(migration, /INVENTORY_POLICY_DEFAULT_UPDATED/);
  assert.match(migration, /INVENTORY_POLICY_OVERRIDE_REMOVED/);
  assert.match(migration, /revoke all on table public\.inventory_policy_defaults/);
  assert.match(migration, /enable row level security/);
  assert.match(rpcGrantMigration, /grant execute on function private\.update_organization_inventory_policy/);
  assert.match(rpcGrantMigration, /grant execute on function private\.remove_inventory_policy_override/);
  assert.match(actions, /updateOrganizationInventoryPolicyAction/);
  assert.match(actions, /removeInventoryPolicyOverrideAction/);
});

test("the Back Office workspace makes inheritance and override source explicit", () => {
  assert.match(page, /inventory_policy_defaults/);
  assert.match(workspace, /Default policy for all stores/);
  assert.match(workspace, /Applies automatically to every store unless that store has an override/);
  assert.match(workspace, /Store overrides/);
  assert.match(workspace, /Organization default/);
  assert.match(workspace, /Remove override/);
  assert.match(workspace, /isDefaultPolicyPending/);
  assert.match(workspace, /isOverridePolicyPending/);
  assert.match(workspace, /isRemoveOverridePending/);
});

test("database regression coverage proves inheritance, override priority, removal, and audit retention", () => {
  assert.match(preflightTest, /public\.update_organization_inventory_policy/);
  assert.match(preflightTest, /a store without an override inherits the organization default/);
  assert.match(preflightTest, /a store override wins over the organization default/);
  assert.match(preflightTest, /removing the override immediately returns the store to its inherited policy/);
  assert.match(preflightTest, /authoritative audit trail/);
});
