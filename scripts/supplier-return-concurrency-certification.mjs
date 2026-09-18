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

async function stockFixture(client, organizationId, storeId, supplierId, sku, quantity) {
  const productId = await rpc(client, "create_catalog_product", { target_barcode: null, target_category_id: null, target_cost_minor: 700, target_description: null, target_name: `Return ${sku}`, target_organization_id: organizationId, target_price_minor: 1200, target_product_type: "simple", target_sku: sku, target_store_ids: [storeId], target_track_inventory: true, target_unit: "each", target_variants: [] });
  const orderId = await rpc(client, "create_purchase_order_v2", { target_expected_at: null, target_lines: [{ product_id: productId, variant_id: null, purchase_unit_code: "each", quantity: String(quantity), unit_cost_minor: 700 }], target_notes: "Supplier-return fixture", target_operation_id: randomUUID(), target_organization_id: organizationId, target_store_id: storeId, target_supplier_id: supplierId });
  const lineId = query(`select id::text from public.purchase_order_lines where purchase_order_id=${sqlUuid(orderId)}`);
  await rpc(client, "receive_purchase_order", { target_lines: [{ purchase_order_line_id: lineId, quantity: String(quantity) }], target_note: "Fixture receipt", target_operation_id: randomUUID(), target_organization_id: organizationId, target_purchase_order_id: orderId });
  return productId;
}

function returnArgs(organizationId, storeId, supplierId, productId, quantity, operationId, note) {
  return { target_lines: [{ product_id: productId, variant_id: null, quantity: String(quantity) }], target_note: note, target_operation_id: operationId, target_organization_id: organizationId, target_store_id: storeId, target_supplier_id: supplierId };
}

async function main() {
  console.log("TINDIO SUPPLIER RETURN CONCURRENCY EVIDENCE");
  const statusOutput = command("pnpm", ["exec", "supabase", "status", "--output", "json"]);
  parseAndValidateLocalSupabaseStatus(statusOutput);
  const status = JSON.parse(statusOutput);
  databaseContainer = command("docker", ["ps", "--format", "{{.Names}}"])
    .split(/\r?\n/).find((name) => name.toLowerCase() === EXPECTED_CONTAINER) ?? fail("Local database container not found.");
  const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const a = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false } });
  const b = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false } });
  const runId = randomUUID();
  const email = `phase11-${runId}@tindio.test`;
  const password = `Tindio-Phase11-${randomUUID()}!`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Phase 11 Owner" } });
  if (created.error) fail(created.error.message);
  await Promise.all([signIn(a, email, password), signIn(b, email, password)]);
  const bootstrapRaw = await rpc(a, "bootstrap_organization", { organization_name: `Phase 11 ${runId.slice(0, 8)}`, register_name: "Register", store_name: "Store" });
  const bootstrap = Array.isArray(bootstrapRaw) ? bootstrapRaw[0] : bootstrapRaw;
  const organizationId = bootstrap.organization_id;
  const storeId = bootstrap.store_id;
  const supplierId = await rpc(a, "create_supplier", { target_address: null, target_contact_name: null, target_email: null, target_name: "Return Supplier", target_notes: null, target_organization_id: organizationId, target_phone: null });

  console.log("Scenario A: concurrent exact replay");
  const exactProduct = await stockFixture(a, organizationId, storeId, supplierId, `R11-A-${runId.slice(0, 6)}`, 10);
  const exactOperation = randomUUID();
  const exactArgs = returnArgs(organizationId, storeId, supplierId, exactProduct, 3, exactOperation, "Exact duplicate");
  const exact = await Promise.all([rpc(a, "return_to_supplier", exactArgs), rpc(b, "return_to_supplier", exactArgs)]);
  assert(exact[0] === exact[1], "Exact replay returned different documents.");
  assert(number(`select count(*) from public.supplier_returns where operation_id=${sqlUuid(exactOperation)}`) === 1, "Exact replay duplicated return headers.");
  assert(number(`select count(*) from public.supplier_return_lines where supplier_return_id=${sqlUuid(exact[0])}`) === 1, "Exact replay duplicated lines.");
  assert(number(`select count(*) from public.inventory_movements where source_type='supplier_return' and source_id=${sqlUuid(exact[0])}`) === 1, "Exact replay duplicated movements.");
  assert(number(`select quantity from public.inventory_levels where organization_id=${sqlUuid(organizationId)} and store_id=${sqlUuid(storeId)} and product_id=${sqlUuid(exactProduct)} and variant_id is null`) === 7, "Exact replay changed stock more than once.");
  assert(number(`select count(*) from public.audit_logs where event_type='SUPPLIER_RETURN_CREATED' and metadata->>'operation_id'='${exactOperation}'`) === 1, "Exact replay duplicated audit evidence.");

  console.log("Scenario B: concurrent conflicting replay");
  const conflictProduct = await stockFixture(a, organizationId, storeId, supplierId, `R11-B-${runId.slice(0, 6)}`, 10);
  const conflictOperation = randomUUID();
  const conflict = await Promise.all([
    a.rpc("return_to_supplier", returnArgs(organizationId, storeId, supplierId, conflictProduct, 3, conflictOperation, "Line conflict")),
    b.rpc("return_to_supplier", returnArgs(organizationId, storeId, supplierId, conflictProduct, 4, conflictOperation, "Line conflict")),
  ]);
  assert(conflict.filter((result) => !result.error).length === 1, "Conflicting replay did not yield exactly one accepted payload.");
  const conflictStock = number(`select quantity from public.inventory_levels where organization_id=${sqlUuid(organizationId)} and store_id=${sqlUuid(storeId)} and product_id=${sqlUuid(conflictProduct)} and variant_id is null`);
  assert(conflictStock === 6 || conflictStock === 7, "Conflicting replay stock does not match either accepted payload.");

  console.log("Scenario C: concurrent distinct operations against finite stock");
  const competingProduct = await stockFixture(a, organizationId, storeId, supplierId, `R11-C-${runId.slice(0, 6)}`, 5);
  const competing = await Promise.all([
    a.rpc("return_to_supplier", returnArgs(organizationId, storeId, supplierId, competingProduct, 4, randomUUID(), "Competing A")),
    b.rpc("return_to_supplier", returnArgs(organizationId, storeId, supplierId, competingProduct, 4, randomUUID(), "Competing B")),
  ]);
  assert(competing.filter((result) => !result.error).length === 1, "Competing returns did not yield exactly one physical return.");
  assert(number(`select quantity from public.inventory_levels where organization_id=${sqlUuid(organizationId)} and store_id=${sqlUuid(storeId)} and product_id=${sqlUuid(competingProduct)} and variant_id is null`) === 1, "Competing returns produced incorrect or negative stock.");
  assert(number(`select count(*) from public.inventory_movements where organization_id=${sqlUuid(organizationId)} and product_id=${sqlUuid(competingProduct)} and source_type='supplier_return'`) === 1, "Competing returns produced duplicate movements.");

  const levels = json("select coalesce(jsonb_agg(to_jsonb(x)),'[]')::text from (select organization_id,store_id,product_id,variant_id,quantity from public.inventory_levels) x");
  const movements = json("select coalesce(jsonb_agg(to_jsonb(x) order by created_at,id),'[]')::text from (select id,organization_id,store_id,product_id,variant_id,quantity_before,quantity_delta,quantity_after,created_at,operation_id,source_id,source_type from public.inventory_movements) x");
  const reconciliation = reconcileInventoryState({ levels, movements });
  assert(reconciliation.ok, `Supplier-return concurrency left ${reconciliation.anomalyCount} reconciliation anomalies.`);
  console.log(JSON.stringify({ exactCallers: 2, returnDocuments: 1, returnLines: 1, movements: 1, auditRows: 1, exactFinalStock: 7, conflictAccepted: 1, competingAccepted: 1, competingFinalStock: 1, reconciliationAnomalies: reconciliation.anomalyCount }, null, 2));
  console.log("SUPPLIER RETURN CONCURRENCY EVIDENCE: PASS");
}

try { await main(); } catch (error) { console.error(error instanceof Error ? error.message : "Phase 11 concurrency failed."); process.exit(1); }
