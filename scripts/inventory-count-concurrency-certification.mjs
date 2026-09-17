import { randomUUID } from "node:crypto";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

import { reconcileInventoryState } from "./lib/inventory-reconciliation.mjs";
import { parseAndValidateLocalSupabaseStatus } from "./lib/certification-safety.mjs";
import { runCommand } from "./lib/run-command.mjs";

const ROOT = process.cwd();
const DB_CONTAINER = "supabase_db_tindio_pos";
let databaseContainer = DB_CONTAINER;
const UUID = /^[0-9a-f-]{36}$/i;
const fail = (message) => { throw new Error(message); };
const assert = (condition, message) => { if (!condition) fail(message); };

function command(commandName, args) {
  const result = runCommand(commandName, args, { cwd: ROOT, env: process.env, capture: true });
  if (result.error || result.status !== 0) fail(`${commandName} ${args.join(" ")} failed: ${String(result.stderr ?? result.error?.message ?? "unknown error").trim()}`);
  return String(result.stdout ?? "").trim();
}

function query(sql) {
  if (!/^\s*select\b/i.test(sql)) fail("Only read-only SELECT evidence is allowed.");
  return command("docker", ["exec", "-e", "PGOPTIONS=-c default_transaction_read_only=on", databaseContainer,
    "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql]);
}

function sqlUuid(value) { if (!UUID.test(value)) fail("Invalid UUID in evidence query."); return `'${value}'::uuid`; }
function scalar(sql) { const rows = query(sql).split(/\r?\n/).filter(Boolean); assert(rows.length === 1, "Expected one evidence row."); return rows[0]; }
function number(sql) { return Number(scalar(sql)); }
function json(sql) { return JSON.parse(scalar(sql)); }

async function rpc(client, name, args, label) {
  const { data, error } = await client.rpc(name, args);
  if (error) fail(`${label}: ${error.code ?? "unknown"}: ${error.message}`);
  return data;
}

async function signIn(client, email, password) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) fail(`Local sign-in failed: ${error?.message ?? "no session"}`);
}

async function main() {
  console.log("TINDIO COUNT CONCURRENCY EVIDENCE");
  console.log("=================================");
  const statusOutput = command("pnpm", ["exec", "supabase", "status", "--output", "json"]);
  parseAndValidateLocalSupabaseStatus(statusOutput);
  const status = JSON.parse(statusOutput);
  const containers = command("docker", ["ps", "--format", "{{.Names}}"])
    .split(/\r?\n/).filter((name) => name.toLowerCase() === DB_CONTAINER);
  assert(containers.length === 1, "Expected one local TINDIO database container.");
  databaseContainer = containers[0];

  const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const clientA = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false } });
  const clientB = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false } });
  const runId = randomUUID();
  const email = `phase08-${runId}@tindio.test`;
  const password = `Tindio-Phase08-${randomUUID()}!`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: "Phase 08 Count Owner" },
  });
  if (createError || !created.user) fail(`Unable to create local user: ${createError?.message ?? "missing user"}`);
  await Promise.all([signIn(clientA, email, password), signIn(clientB, email, password)]);

  const bootstrapRaw = await rpc(clientA, "bootstrap_organization", {
    organization_name: `Phase 08 Count ${runId.slice(0, 8)}`,
    register_name: "Phase 08 Register", store_name: "Phase 08 Store",
  }, "Organization bootstrap failed");
  const bootstrap = Array.isArray(bootstrapRaw) ? bootstrapRaw[0] : bootstrapRaw;
  const organizationId = bootstrap.organization_id;
  const storeId = bootstrap.store_id;
  await rpc(clientA, "create_inventory_adjustment_reason", {
    target_code: "PHASE08_OPENING", target_movement_type: "OPENING_STOCK",
    target_name: "Phase 08 opening stock", target_organization_id: organizationId,
  }, "Opening-stock reason creation failed");
  const productId = await rpc(clientA, "create_catalog_product", {
    target_barcode: `8${Date.now().toString().slice(-12)}`, target_category_id: null,
    target_cost_minor: 500, target_description: "Count concurrency fixture",
    target_name: "Phase 08 Count Item", target_organization_id: organizationId,
    target_price_minor: 1000, target_product_type: "simple", target_sku: `P08-${runId.slice(0, 8)}`,
    target_store_ids: [storeId], target_track_inventory: true, target_unit: "each", target_variants: [],
  }, "Product creation failed");
  await rpc(clientA, "record_inventory_adjustment_v3", {
    target_approval_request_id: null, target_note: "Phase 08 opening stock fixture",
    target_operation_id: randomUUID(), target_organization_id: organizationId,
    target_product_id: productId, target_quantity_delta: 10,
    target_reason_code: "PHASE08_OPENING", target_store_id: storeId, target_variant_id: null,
  }, "Opening stock failed");

  const countId = await rpc(clientA, "create_inventory_count_plan_v2", {
    target_count_mode: "standard", target_include_zero_stock: true,
    target_note: "Phase 08 concurrent post", target_organization_id: organizationId,
    target_scope_reference_id: null, target_scope_type: "selected",
    target_selected_items: [{ product_id: productId, variant_id: null }],
    target_sort_mode: "product_name", target_store_id: storeId,
  }, "Count preparation failed");
  await rpc(clientA, "save_inventory_count_line_v2", {
    target_counted_quantity: 7, target_inventory_count_id: countId,
    target_organization_id: organizationId, target_product_id: productId, target_variant_id: null,
  }, "Physical count save failed");
  await rpc(clientA, "submit_inventory_count_for_review", {
    target_inventory_count_id: countId, target_organization_id: organizationId,
  }, "Count review submission failed");

  const operationId = randomUUID();
  const postArgs = { target_inventory_count_id: countId, target_operation_id: operationId, target_organization_id: organizationId };
  await Promise.all([
    rpc(clientA, "post_inventory_count", postArgs, "Concurrent count post A failed"),
    rpc(clientB, "post_inventory_count", postArgs, "Concurrent count post B failed"),
  ]);

  const physicalMutations = number(`select count(*) from public.inventory_movements where organization_id=${sqlUuid(organizationId)} and source_type='inventory_count' and source_id=${sqlUuid(countId)} and movement_type='COUNT'`);
  assert(physicalMutations === 1, "Concurrent count replay created duplicate COUNT movements.");
  const finalQuantity = number(`select quantity from public.inventory_levels where organization_id=${sqlUuid(organizationId)} and store_id=${sqlUuid(storeId)} and product_id=${sqlUuid(productId)} and variant_id is null`);
  assert(finalQuantity === 7, "Concurrent count replay applied the variance more than once.");
  assert(scalar(`select status from public.inventory_counts where id=${sqlUuid(countId)}`) === "posted", "Concurrent count did not become posted.");
  assert(scalar(`select post_operation_id::text from public.inventory_counts where id=${sqlUuid(countId)}`) === operationId, "Count operation identity was not retained.");

  const levels = json("select coalesce(jsonb_agg(to_jsonb(x)),'[]')::text from (select organization_id,store_id,product_id,variant_id,quantity from public.inventory_levels) x");
  const movements = json("select coalesce(jsonb_agg(to_jsonb(x) order by created_at,id),'[]')::text from (select id,organization_id,store_id,product_id,variant_id,quantity_before,quantity_delta,quantity_after,created_at,operation_id,source_id,source_type from public.inventory_movements) x");
  const reconciliation = reconcileInventoryState({ levels, movements });
  assert(reconciliation.ok, `Count concurrency left ${reconciliation.anomalyCount} reconciliation anomalies.`);

  console.log(JSON.stringify({ successfulCallers: 2, replayedCallers: 1, physicalMutations,
    finalQuantity, reconciliation: { anomalyCount: reconciliation.anomalyCount, movementCount: reconciliation.movementCount } }, null, 2));
  console.log("COUNT CONCURRENCY EVIDENCE: PASS");
}

try { await main(); } catch (error) {
  console.error(error instanceof Error ? error.message : "Phase 08 count concurrency failed.");
  process.exit(1);
}
