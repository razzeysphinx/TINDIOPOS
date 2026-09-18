import { randomUUID } from "node:crypto";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

import { reconcileInventoryState } from "./lib/inventory-reconciliation.mjs";
import { parseAndValidateLocalSupabaseStatus } from "./lib/certification-safety.mjs";
import { runCommand } from "./lib/run-command.mjs";

const ROOT = process.cwd();
const EXPECTED_CONTAINER = "supabase_db_tindio_pos";
let databaseContainer = EXPECTED_CONTAINER;
const UUID = /^[0-9a-f-]{36}$/i;
const fail = (message) => { throw new Error(message); };
const assert = (condition, message) => { if (!condition) fail(message); };

function command(name, args) {
  const result = runCommand(name, args, { cwd: ROOT, env: process.env, capture: true });
  if (result.error || result.status !== 0) fail(`${name} ${args.join(" ")} failed: ${String(result.stderr ?? result.error?.message ?? "unknown error").trim()}`);
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
async function createOrder(client, organizationId, storeId, supplierId, productId, quantity) {
  return rpc(client, "create_purchase_order_v2", {
    target_expected_at: null, target_lines: [{ product_id: productId, variant_id: null,
      purchase_unit_code: "each", quantity, unit_cost_minor: 1200 }],
    target_notes: "Phase 09 concurrency fixture", target_operation_id: randomUUID(),
    target_organization_id: organizationId, target_store_id: storeId, target_supplier_id: supplierId,
  }, "Purchase-order creation failed");
}

async function main() {
  console.log("TINDIO PURCHASE RECEIPT CONCURRENCY EVIDENCE");
  console.log("============================================");
  const statusOutput = command("pnpm", ["exec", "supabase", "status", "--output", "json"]);
  parseAndValidateLocalSupabaseStatus(statusOutput);
  const status = JSON.parse(statusOutput);
  const containers = command("docker", ["ps", "--format", "{{.Names}}"])
    .split(/\r?\n/).filter((name) => name.toLowerCase() === EXPECTED_CONTAINER);
  assert(containers.length === 1, "Expected one local TINDIO database container.");
  databaseContainer = containers[0];

  const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const clientA = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false } });
  const clientB = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false } });
  const runId = randomUUID();
  const email = `phase09-${runId}@tindio.test`;
  const password = `Tindio-Phase09-${randomUUID()}!`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true,
    user_metadata: { full_name: "Phase 09 Receipt Owner" } });
  if (createError || !created.user) fail(`Unable to create local user: ${createError?.message ?? "missing user"}`);
  await Promise.all([signIn(clientA, email, password), signIn(clientB, email, password)]);

  const bootstrapRaw = await rpc(clientA, "bootstrap_organization", {
    organization_name: `Phase 09 Purchase ${runId.slice(0, 8)}`,
    register_name: "Phase 09 Register", store_name: "Phase 09 Store",
  }, "Organization bootstrap failed");
  const bootstrap = Array.isArray(bootstrapRaw) ? bootstrapRaw[0] : bootstrapRaw;
  const organizationId = bootstrap.organization_id;
  const storeId = bootstrap.store_id;
  const supplierId = await rpc(clientA, "create_supplier", {
    target_address: null, target_contact_name: null, target_email: null,
    target_name: "Phase 09 Supplier", target_notes: null, target_organization_id: organizationId, target_phone: null,
  }, "Supplier creation failed");
  const productId = await rpc(clientA, "create_catalog_product", {
    target_barcode: `9${Date.now().toString().slice(-12)}`, target_category_id: null, target_cost_minor: 500,
    target_description: "Receipt concurrency fixture", target_name: "Phase 09 Purchase Item",
    target_organization_id: organizationId, target_price_minor: 2000, target_product_type: "simple",
    target_sku: `P09-${runId.slice(0, 8)}`, target_store_ids: [storeId], target_track_inventory: true,
    target_unit: "each", target_variants: [],
  }, "Product creation failed");

  const replayOrderId = await createOrder(clientA, organizationId, storeId, supplierId, productId, "10");
  const replayLineId = scalar(`select id::text from public.purchase_order_lines where purchase_order_id=${sqlUuid(replayOrderId)}`);
  const replayOperationId = randomUUID();
  const replayArgs = { target_lines: [{ purchase_order_line_id: replayLineId, quantity: "4" }],
    target_note: "Concurrent exact replay", target_operation_id: replayOperationId,
    target_organization_id: organizationId, target_purchase_order_id: replayOrderId };
  const replayResults = await Promise.all([
    rpc(clientA, "receive_purchase_order", replayArgs, "Exact receipt replay A failed"),
    rpc(clientB, "receive_purchase_order", replayArgs, "Exact receipt replay B failed"),
  ]);
  assert(replayResults[0] === replayResults[1], "Exact receipt replay returned different receipt IDs.");

  const competingOrderId = await createOrder(clientA, organizationId, storeId, supplierId, productId, "5");
  const competingLineId = scalar(`select id::text from public.purchase_order_lines where purchase_order_id=${sqlUuid(competingOrderId)}`);
  const competingResults = await Promise.allSettled([
    clientA.rpc("receive_purchase_order", { target_lines: [{ purchase_order_line_id: competingLineId, quantity: "4" }],
      target_note: "Competing receipt A", target_operation_id: randomUUID(), target_organization_id: organizationId,
      target_purchase_order_id: competingOrderId }),
    clientB.rpc("receive_purchase_order", { target_lines: [{ purchase_order_line_id: competingLineId, quantity: "4" }],
      target_note: "Competing receipt B", target_operation_id: randomUUID(), target_organization_id: organizationId,
      target_purchase_order_id: competingOrderId }),
  ]);
  const successfulCompeting = competingResults.filter((result) => result.status === "fulfilled" && !result.value.error).length;
  assert(successfulCompeting === 1, "Exactly one competing over-receipt attempt must succeed.");

  const receipts = number(`select count(*) from public.goods_receipts where organization_id=${sqlUuid(organizationId)}`);
  const movements = number(`select count(*) from public.inventory_movements where organization_id=${sqlUuid(organizationId)} and source_type='goods_receipt'`);
  const stock = number(`select quantity from public.inventory_levels where organization_id=${sqlUuid(organizationId)} and store_id=${sqlUuid(storeId)} and product_id=${sqlUuid(productId)} and variant_id is null`);
  const replayReceived = number(`select received_quantity from public.purchase_order_lines where id=${sqlUuid(replayLineId)}`);
  const competingReceived = number(`select received_quantity from public.purchase_order_lines where id=${sqlUuid(competingLineId)}`);
  const snapshotRows = number(`select count(*) from public.goods_receipt_lines where organization_id=${sqlUuid(organizationId)} and base_quantity_received=quantity_received and purchase_unit_factor_to_base=1 and purchase_unit_cost_minor=1200 and stock_unit_cost_minor=1200`);
  const averageCost = number(`select average_cost_minor from public.inventory_levels where organization_id=${sqlUuid(organizationId)} and store_id=${sqlUuid(storeId)} and product_id=${sqlUuid(productId)} and variant_id is null`);
  assert(receipts === 2 && movements === 2, "Receipt concurrency created duplicate documents or movements.");
  assert(stock === 8 && replayReceived === 4 && competingReceived === 4, "Receipt concurrency credited stock or received quantities incorrectly.");
  assert(snapshotRows === 2 && averageCost === 1200, "Receipt conversion or valuation snapshots are incorrect.");

  const levels = json("select coalesce(jsonb_agg(to_jsonb(x)),'[]')::text from (select organization_id,store_id,product_id,variant_id,quantity from public.inventory_levels) x");
  const ledger = json("select coalesce(jsonb_agg(to_jsonb(x) order by created_at,id),'[]')::text from (select id,organization_id,store_id,product_id,variant_id,quantity_before,quantity_delta,quantity_after,created_at,operation_id,source_id,source_type from public.inventory_movements) x");
  const reconciliation = reconcileInventoryState({ levels, movements: ledger });
  assert(reconciliation.ok, `Receipt concurrency left ${reconciliation.anomalyCount} reconciliation anomalies.`);
  console.log(JSON.stringify({ exactReplayCallers: 2, exactReplayReceipts: 1, successfulCompeting,
    receipts, movements, stock, averageCost, snapshotRows, reconciliation: { anomalyCount: reconciliation.anomalyCount } }, null, 2));
  console.log("PURCHASE RECEIPT CONCURRENCY EVIDENCE: PASS");
}

try { await main(); } catch (error) {
  console.error(error instanceof Error ? error.message : "Phase 09 receipt concurrency failed.");
  process.exit(1);
}
