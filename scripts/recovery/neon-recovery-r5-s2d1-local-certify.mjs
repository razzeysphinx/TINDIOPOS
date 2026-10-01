import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import process from "node:process";

import { parseAndValidateLocalSupabaseStatus } from "../lib/certification-safety.mjs";
import { runCommand } from "../lib/run-command.mjs";
import { runSql } from "../lib/phase-04-postgres-docker.mjs";

function run(command, args, capture = false) {
  console.log(`$ ${command} ${args.join(" ")}`);
  const result = runCommand(command, args, { cwd: process.cwd(), env: process.env, capture });
  if (result.error || result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
  return result;
}

function localDatabaseUrl() {
  const result = run("pnpm", ["exec", "supabase", "status", "--output", "json"], true);
  parseAndValidateLocalSupabaseStatus(result.stdout ?? "");
  const status = JSON.parse(result.stdout ?? "{}");
  assert.ok(typeof status.DB_URL === "string");
  return status.DB_URL;
}

run("node", ["scripts/certification-local-target-preflight.mjs"]);
run("pnpm", ["exec", "supabase", "db", "reset", "--local"]);
const db = localDatabaseUrl();

for (const path of [
  "database/migrations/0002_provider_neutral_business_identity.sql",
  "database/provider/local/01_identity.sql",
  "database/migrations/0003_provider_neutral_roles_rls.sql",
  "database/provider/local/00_roles.sql",
  "database/migrations/0004_inventory_replenishment_read_models.sql",
  "database/migrations/0005_inventory_core_read_model_extension.sql",
  "database/migrations/0006_inventory_purchasing_read_model.sql",
]) runSql(db, await readFile(path, "utf8"));

const metadata = JSON.parse(runSql(db, `
select jsonb_build_object(
  'functionCount', count(*),
  'securityDefinerCount', count(*) filter (where function.prosecdef),
  'stableCount', count(*) filter (where function.provolatile = 's'),
  'canonicalExecute', bool_or(pg_catalog.has_function_privilege('tindio_authenticated', function.oid, 'EXECUTE')),
  'authenticatedExecute', bool_or(pg_catalog.has_function_privilege('authenticated', function.oid, 'EXECUTE')),
  'anonExecute', bool_or(pg_catalog.has_function_privilege('anon', function.oid, 'EXECUTE')),
  'authHelperReferences', count(*) filter (where pg_catalog.pg_get_functiondef(function.oid) ~* 'auth\\.(uid|jwt|role|user_id)\\s*\\(')
)::text
from pg_catalog.pg_proc function
join pg_catalog.pg_namespace namespace on namespace.oid = function.pronamespace
where namespace.nspname = 'public' and function.proname = 'get_inventory_purchasing_bundle_v1';`));

assert.equal(Number(metadata.functionCount), 1);
assert.equal(Number(metadata.securityDefinerCount), 0);
assert.equal(Number(metadata.stableCount), 1);
assert.equal(metadata.canonicalExecute, true);
assert.equal(metadata.authenticatedExecute, true);
assert.equal(metadata.anonExecute, false);
assert.equal(Number(metadata.authHelperReferences), 0);

const smoke = JSON.parse(runSql(db, `
select public.get_inventory_purchasing_bundle_v1(
  target_organization_id => '00000000-0000-0000-0000-000000000000'::uuid,
  target_store_ids => null,
  requested_needs => array[
    'stores', 'products', 'variants', 'productUnits', 'productStoreSettings',
    'suppliers', 'purchaseOrders', 'purchaseOrderLines', 'goodsReceipts',
    'goodsReceiptLines', 'openPurchaseOrdersCount'
  ]::text[]
)::text;`));

for (const key of [
  "stores", "products", "variants", "productUnits", "productStoreSettings", "suppliers",
  "purchaseOrders", "purchaseOrderLines", "goodsReceipts", "goodsReceiptLines",
]) assert.ok(Array.isArray(smoke[key]), `${key} must return an array`);

assert.equal(Number(smoke.openPurchaseOrdersCount), 0);
run("pnpm", ["exec", "supabase", "db", "lint", "--local", "--level", "error", "--fail-on", "error"]);
console.log("R5-S2D1 LOCAL PURCHASING CERTIFICATION:");
console.log(JSON.stringify(metadata, null, 2));
console.log("TINDIO R5-S2D1 LOCAL CERTIFICATION: PASS");
