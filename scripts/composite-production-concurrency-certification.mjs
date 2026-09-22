import { randomUUID } from "node:crypto";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { reconcileInventoryState } from "./lib/inventory-reconciliation.mjs";
import { parseAndValidateLocalSupabaseStatus } from "./lib/certification-safety.mjs";
import { runCommand } from "./lib/run-command.mjs";

const ROOT = process.cwd();
const EXPECTED_CONTAINER = "supabase_db_tindio_pos";
let databaseContainer = EXPECTED_CONTAINER;
const fail = (message) => { throw new Error(message); };
const assert = (condition, message) => { if (!condition) fail(message); };
function command(name, args) { const result = runCommand(name, args, { cwd: ROOT, env: process.env, capture: true }); if (result.error || result.status !== 0) fail(`${name} failed: ${String(result.stderr ?? result.error?.message ?? "unknown")}`); return String(result.stdout ?? "").trim(); }
function query(sql) { if (!/^\s*select\b/i.test(sql)) fail("Only read-only evidence queries are allowed."); return command("docker", ["exec", "-e", "PGOPTIONS=-c default_transaction_read_only=on", databaseContainer, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql]); }
function sqlUuid(value) { if (!/^[0-9a-f-]{36}$/i.test(value)) fail("Invalid UUID."); return `'${value}'::uuid`; }
function number(sql) { return Number(query(sql)); }
function json(sql) { return JSON.parse(query(sql)); }
async function signIn(client, email, password) { const { data, error } = await client.auth.signInWithPassword({ email, password }); if (error || !data.session) fail(`Sign-in failed: ${error?.message ?? "no session"}`); }
async function rpc(client, name, args) { const { data, error } = await client.rpc(name, args); if (error) fail(`${name}: ${error.code}: ${error.message}`); return data; }

async function productionFixture(client, organizationId, storeId, reasonCode, suffix, stockQuantity) {
  const componentId = await rpc(client, "create_catalog_product_v3", {
    target_allow_fractional_quantity: false,
    target_barcode: null,
    target_category_id: null,
    target_composite_inventory_mode: "made_to_order",
    target_cost_minor: 500,
    target_description: null,
    target_image_url: null,
    target_is_variable_price: false,
    target_name: `Phase12 Component ${suffix}`,
    target_organization_id: organizationId,
    target_price_minor: 1000,
    target_product_type: "simple",
    target_sku: `P12-C-${suffix}`,
    target_store_ids: [storeId],
    target_track_inventory: true,
    target_unit: "each",
    target_variants: [],
  });
  const assemblyId = await rpc(client, "create_catalog_product_v3", {
    target_allow_fractional_quantity: false,
    target_barcode: null,
    target_category_id: null,
    target_composite_inventory_mode: "stocked_assembly",
    target_cost_minor: 0,
    target_description: null,
    target_image_url: null,
    target_is_variable_price: false,
    target_name: `Phase12 Assembly ${suffix}`,
    target_organization_id: organizationId,
    target_price_minor: 3000,
    target_product_type: "composite",
    target_sku: `P12-A-${suffix}`,
    target_store_ids: [storeId],
    target_track_inventory: true,
    target_unit: "each",
    target_variants: [],
  });
  const inserted = await client.from("product_components").insert({
    organization_id: organizationId,
    product_id: assemblyId,
    component_product_id: componentId,
    component_variant_id: null,
    quantity_per_composite: 2,
  });
  if (inserted.error) fail(`Recipe insert failed: ${inserted.error.message}`);
  await rpc(client, "record_inventory_adjustment_v3", {
    target_note: "Phase 12 production fixture",
    target_operation_id: randomUUID(),
    target_organization_id: organizationId,
    target_product_id: componentId,
    target_quantity_delta: stockQuantity,
    target_reason_code: reasonCode,
    target_store_id: storeId,
  });
  return { assemblyId, componentId };
}

function productionArgs(organizationId, storeId, productId, quantity, operationId, note) {
  return {
    target_note: note,
    target_operation_id: operationId,
    target_organization_id: organizationId,
    target_product_id: productId,
    target_quantity: quantity,
    target_store_id: storeId,
  };
}

async function main() {
  console.log("TINDIO COMPOSITE PRODUCTION CONCURRENCY EVIDENCE");
  const statusOutput = command("pnpm", ["exec", "supabase", "status", "--output", "json"]);
  parseAndValidateLocalSupabaseStatus(statusOutput);
  const status = JSON.parse(statusOutput);
  databaseContainer = command("docker", ["ps", "--format", "{{.Names}}"])
    .split(/\r?\n/).find((name) => name.toLowerCase() === EXPECTED_CONTAINER) ?? fail("Local database container not found.");
  const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const a = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false } });
  const b = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false } });
  const runId = randomUUID();
  const email = `phase12-${runId}@tindio.test`;
  const password = `Tindio-Phase12-${randomUUID()}!`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Phase 12 Owner" } });
  if (created.error) fail(created.error.message);
  await Promise.all([signIn(a, email, password), signIn(b, email, password)]);
  const bootstrapRaw = await rpc(a, "bootstrap_organization", { organization_name: `Phase 12 ${runId.slice(0, 8)}`, register_name: "Register", store_name: "Store" });
  const bootstrap = Array.isArray(bootstrapRaw) ? bootstrapRaw[0] : bootstrapRaw;
  const organizationId = bootstrap.organization_id;
  const storeId = bootstrap.store_id;
  const reasonCode = `P12${runId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  await rpc(a, "create_inventory_adjustment_reason", {
    target_code: reasonCode,
    target_movement_type: "OPENING_STOCK",
    target_name: "Phase 12 seed",
    target_organization_id: organizationId,
  });

  console.log("Scenario A: concurrent exact production replay");
  const exactFixture = await productionFixture(a, organizationId, storeId, reasonCode, `A${runId.slice(0, 5)}`, 10);
  const exactOperation = randomUUID();
  const exactArgs = productionArgs(organizationId, storeId, exactFixture.assemblyId, 1, exactOperation, "Exact duplicate");
  const exact = await Promise.all([rpc(a, "produce_composite", exactArgs), rpc(b, "produce_composite", exactArgs)]);
  assert(exact[0] === exact[1], "Exact production replay returned different runs.");
  assert(number(`select count(*) from public.production_runs where operation_id=${sqlUuid(exactOperation)}`) === 1, "Exact replay duplicated production headers.");
  assert(number(`select count(*) from public.production_run_components where production_run_id=${sqlUuid(exact[0])}`) === 1, "Exact replay duplicated component snapshots.");
  assert(number(`select count(*) from public.inventory_movements where source_type='production_run' and source_id=${sqlUuid(exact[0])}`) === 2, "Exact replay duplicated production movements.");
  assert(number(`select quantity from public.inventory_levels where organization_id=${sqlUuid(organizationId)} and store_id=${sqlUuid(storeId)} and product_id=${sqlUuid(exactFixture.componentId)} and variant_id is null`) === 8, "Exact replay consumed component stock more than once.");
  assert(number(`select quantity from public.inventory_levels where organization_id=${sqlUuid(organizationId)} and store_id=${sqlUuid(storeId)} and product_id=${sqlUuid(exactFixture.assemblyId)} and variant_id is null`) === 1, "Exact replay produced finished stock more than once.");

  console.log("Scenario B: concurrent conflicting production replay");
  const conflictFixture = await productionFixture(a, organizationId, storeId, reasonCode, `B${runId.slice(0, 5)}`, 10);
  const conflictOperation = randomUUID();
  const conflict = await Promise.all([
    a.rpc("produce_composite", productionArgs(organizationId, storeId, conflictFixture.assemblyId, 1, conflictOperation, "Conflict")),
    b.rpc("produce_composite", productionArgs(organizationId, storeId, conflictFixture.assemblyId, 2, conflictOperation, "Conflict")),
  ]);
  assert(conflict.filter((result) => !result.error).length === 1, "Conflicting production replay did not yield one accepted payload.");
  assert(number(`select count(*) from public.production_runs where operation_id=${sqlUuid(conflictOperation)}`) === 1, "Conflicting replay created more than one run.");

  console.log("Scenario C: concurrent distinct production against finite components");
  const competingFixture = await productionFixture(a, organizationId, storeId, reasonCode, `C${runId.slice(0, 5)}`, 5);
  const competing = await Promise.all([
    a.rpc("produce_composite", productionArgs(organizationId, storeId, competingFixture.assemblyId, 2, randomUUID(), "Competing A")),
    b.rpc("produce_composite", productionArgs(organizationId, storeId, competingFixture.assemblyId, 2, randomUUID(), "Competing B")),
  ]);
  assert(competing.filter((result) => !result.error).length === 1, "Finite component stock allowed more than one competing production.");
  assert(number(`select quantity from public.inventory_levels where organization_id=${sqlUuid(organizationId)} and store_id=${sqlUuid(storeId)} and product_id=${sqlUuid(competingFixture.componentId)} and variant_id is null`) === 1, "Competing production produced incorrect component stock.");
  assert(number(`select quantity from public.inventory_levels where organization_id=${sqlUuid(organizationId)} and store_id=${sqlUuid(storeId)} and product_id=${sqlUuid(competingFixture.assemblyId)} and variant_id is null`) === 2, "Competing production produced incorrect finished stock.");

  const levels = json("select coalesce(jsonb_agg(to_jsonb(x)),'[]')::text from (select organization_id,store_id,product_id,variant_id,quantity from public.inventory_levels) x");
  const movements = json("select coalesce(jsonb_agg(to_jsonb(x) order by created_at,id),'[]')::text from (select id,organization_id,store_id,product_id,variant_id,quantity_before,quantity_delta,quantity_after,created_at,operation_id,source_id,source_type from public.inventory_movements) x");
  const reconciliation = reconcileInventoryState({ levels, movements });
  assert(reconciliation.ok, `Composite production concurrency left ${reconciliation.anomalyCount} reconciliation anomalies.`);
  console.log(JSON.stringify({
    exactCallers: 2,
    exactRuns: 1,
    exactSnapshots: 1,
    exactMovements: 2,
    conflictAccepted: 1,
    competingAccepted: 1,
    competingComponentFinalStock: 1,
    competingOutputFinalStock: 2,
    reconciliationAnomalies: reconciliation.anomalyCount,
  }, null, 2));
  console.log("COMPOSITE PRODUCTION CONCURRENCY EVIDENCE: PASS");
}

try { await main(); } catch (error) { console.error(error instanceof Error ? error.message : "Phase 12 concurrency failed."); process.exit(1); }
