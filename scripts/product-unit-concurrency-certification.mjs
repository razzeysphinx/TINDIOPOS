import { randomUUID } from "node:crypto";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
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
async function signIn(client, email, password) { const { data, error } = await client.auth.signInWithPassword({ email, password }); if (error || !data.session) fail(`Sign-in failed: ${error?.message ?? "no session"}`); }
async function rpc(client, name, args) { const { data, error } = await client.rpc(name, args); if (error) fail(`${name}: ${error.code}: ${error.message}`); return data; }

async function main() {
  console.log("TINDIO PRODUCT UNIT CONCURRENCY EVIDENCE");
  const statusOutput = command("pnpm", ["exec", "supabase", "status", "--output", "json"]);
  parseAndValidateLocalSupabaseStatus(statusOutput);
  const status = JSON.parse(statusOutput);
  databaseContainer = command("docker", ["ps", "--format", "{{.Names}}"])
    .split(/\r?\n/).find((name) => name.toLowerCase() === EXPECTED_CONTAINER) ?? fail("Local database container not found.");
  const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const a = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false } });
  const b = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false } });
  const runId = randomUUID();
  const email = `phase10-${runId}@tindio.test`;
  const password = `Tindio-Phase10-${randomUUID()}!`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Phase 10 Owner" } });
  if (created.error) fail(created.error.message);
  await Promise.all([signIn(a, email, password), signIn(b, email, password)]);
  const bootstrapRaw = await rpc(a, "bootstrap_organization", { organization_name: `Phase 10 ${runId.slice(0, 8)}`, register_name: "Register", store_name: "Store" });
  const bootstrap = Array.isArray(bootstrapRaw) ? bootstrapRaw[0] : bootstrapRaw;
  const organizationId = bootstrap.organization_id;
  const productId = await rpc(a, "create_catalog_product", { target_barcode: null, target_category_id: null, target_cost_minor: 100, target_description: null, target_name: "Unit Fixture", target_organization_id: organizationId, target_price_minor: 200, target_product_type: "simple", target_sku: `U-${runId.slice(0, 8)}`, target_store_ids: [bootstrap.store_id], target_track_inventory: true, target_unit: "each", target_variants: [] });

  const createOperation = randomUUID();
  const createArgs = { target_factor_to_base: 24, target_is_purchase_unit: true, target_is_sale_unit: false, target_operation_id: createOperation, target_organization_id: organizationId, target_product_id: productId, target_unit_code: "case", target_unit_name: "Case" };
  const createdIds = await Promise.all([rpc(a, "create_product_unit", createArgs), rpc(b, "create_product_unit", createArgs)]);
  assert(createdIds[0] === createdIds[1], "Exact concurrent create did not replay the same unit.");
  assert(number(`select count(*) from public.product_units where id=${sqlUuid(createdIds[0])}`) === 1, "Exact create duplicated the unit row.");
  assert(number(`select count(*) from public.audit_logs where organization_id=${sqlUuid(organizationId)} and event_type='PRODUCT_UNIT_CREATED' and metadata->>'operation_id'='${createOperation}'`) === 1, "Exact create duplicated audit evidence.");

  const competing = await Promise.all([
    a.rpc("create_product_unit", { ...createArgs, target_operation_id: randomUUID(), target_unit_code: "pack", target_unit_name: "Pack A" }),
    b.rpc("create_product_unit", { ...createArgs, target_operation_id: randomUUID(), target_unit_code: " PACK ", target_unit_name: "Pack B" }),
  ]);
  assert(competing.filter((result) => !result.error).length === 1, "Competing normalized codes did not yield exactly one unit.");
  assert(number(`select count(*) from public.product_units where product_id=${sqlUuid(productId)} and unit_code='pack'`) === 1, "Competing code created duplicate logical units.");

  const updateOperation = randomUUID();
  const updateArgs = { target_factor_to_base: 12, target_is_purchase_unit: true, target_is_sale_unit: true, target_operation_id: updateOperation, target_organization_id: organizationId, target_unit_code: "case", target_unit_id: createdIds[0], target_unit_name: "Half case" };
  const updatedIds = await Promise.all([rpc(a, "update_product_unit", updateArgs), rpc(b, "update_product_unit", updateArgs)]);
  assert(updatedIds[0] === updatedIds[1] && number(`select count(*) from public.audit_logs where event_type='PRODUCT_UNIT_UPDATED' and metadata->>'operation_id'='${updateOperation}'`) === 1, "Exact update replay duplicated effects.");

  const deleteOperation = randomUUID();
  const deleteArgs = { target_operation_id: deleteOperation, target_organization_id: organizationId, target_unit_id: createdIds[0] };
  const deletedIds = await Promise.all([rpc(a, "delete_product_unit", deleteArgs), rpc(b, "delete_product_unit", deleteArgs)]);
  assert(deletedIds[0] === deletedIds[1] && number(`select count(*) from public.product_units where id=${sqlUuid(createdIds[0])}`) === 0, "Exact delete replay was not stable.");
  assert(number(`select count(*) from public.audit_logs where event_type='PRODUCT_UNIT_DELETED' and metadata->>'operation_id'='${deleteOperation}'`) === 1, "Exact delete duplicated audit evidence.");
  console.log(JSON.stringify({ exactCreateCallers: 2, unitRows: 1, createAuditRows: 1, competingSuccesses: 1, updateAuditRows: 1, deleteAuditRows: 1 }, null, 2));
  console.log("PRODUCT UNIT CONCURRENCY EVIDENCE: PASS");
}

try { await main(); } catch (error) { console.error(error instanceof Error ? error.message : "Phase 10 concurrency failed."); process.exit(1); }
