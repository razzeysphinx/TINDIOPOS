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

function command(command, args) {
  const result = runCommand(command, args, { cwd: ROOT, env: process.env, capture: true });
  if (result.error || result.status !== 0) fail(`${command} ${args.join(" ")} failed: ${String(result.stderr ?? result.error?.message ?? "unknown error").trim()}`);
  return String(result.stdout ?? "").trim();
}

function localStatus() {
  const output = command("pnpm", ["exec", "supabase", "status", "--output", "json"]);
  parseAndValidateLocalSupabaseStatus(output);
  return JSON.parse(output);
}

function sqlUuid(value) {
  if (!UUID.test(value)) fail("Invalid UUID in local evidence query.");
  return `'${value}'::uuid`;
}

function query(sql) {
  if (!/^\s*select\b/i.test(sql)) fail("Only read-only SELECT evidence is allowed.");
  return command("docker", ["exec", "-e", "PGOPTIONS=-c default_transaction_read_only=on", databaseContainer,
    "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql]);
}

function scalar(sql) {
  const rows = query(sql).split(/\r?\n/).filter(Boolean);
  assert(rows.length === 1, "Evidence query did not return one row.");
  return rows[0];
}

function number(sql) { return Number(scalar(sql)); }
function json(sql) { return JSON.parse(scalar(sql)); }

async function rpc(client, name, args, label) {
  const { data, error } = await client.rpc(name, args);
  if (error) {
    const wrapped = new Error(`${label}: ${error.code ?? "unknown"}: ${error.message}`);
    wrapped.code = error.code;
    throw wrapped;
  }
  return data;
}

async function signIn(client, email, password) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) fail(`Local sign-in failed: ${error?.message ?? "no session"}`);
}

async function main() {
  console.log("TINDIO REQUEST TRANSFER CONCURRENCY EVIDENCE");
  console.log("============================================");
  const status = localStatus();
  const containers = command("docker", ["ps", "--format", "{{.Names}}"])
    .split(/\r?\n/).filter((name) => name.toLowerCase() === DB_CONTAINER);
  assert(containers.length === 1, "Expected exactly one local TINDIO Supabase database container.");
  databaseContainer = containers[0];

  const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const clientA = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false } });
  const clientB = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false } });
  const runId = randomUUID();
  const email = `phase06-${runId}@tindio.test`;
  const password = `Tindio-Phase06-${randomUUID()}!`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: "Phase 06 Request Concurrency Owner" },
  });
  if (createError || !created.user) fail(`Unable to create local test user: ${createError?.message ?? "missing user"}`);
  await Promise.all([signIn(clientA, email, password), signIn(clientB, email, password)]);

  const bootstrapRaw = await rpc(clientA, "bootstrap_organization", {
    organization_name: `Phase 06 Request ${runId.slice(0, 8)}`,
    register_name: "Phase 06 Register", store_name: "Phase 06 Source",
  }, "Organization bootstrap failed");
  const bootstrap = Array.isArray(bootstrapRaw) ? bootstrapRaw[0] : bootstrapRaw;
  const organizationId = bootstrap.organization_id;
  const sourceStoreId = bootstrap.store_id;
  const { data: destination, error: destinationError } = await clientA.from("stores")
    .insert({ organization_id: organizationId, name: "Phase 06 Destination", code: `P06-${runId.slice(0, 6).toUpperCase()}` })
    .select("id").single();
  if (destinationError) fail(`Destination creation failed: ${destinationError.message}`);
  const destinationStoreId = destination.id;
  const { data: employee, error: employeeError } = await clientA.from("employees")
    .select("id").eq("organization_id", organizationId).eq("profile_id", created.user.id).single();
  if (employeeError) fail(`Employee lookup failed: ${employeeError.message}`);
  const { error: assignmentError } = await clientA.from("employee_stores")
    .insert({ organization_id: organizationId, employee_id: employee.id, store_id: destinationStoreId });
  if (assignmentError) fail(`Destination assignment failed: ${assignmentError.message}`);

  await rpc(clientA, "create_inventory_adjustment_reason", {
    target_code: "PHASE06_SEED", target_movement_type: "ADJUSTMENT",
    target_name: "Phase 06 request fixture", target_organization_id: organizationId,
  }, "Adjustment reason creation failed");
  const productId = await rpc(clientA, "create_catalog_product", {
    target_barcode: `8${Date.now().toString().slice(-12)}`, target_category_id: null,
    target_cost_minor: 500, target_description: "Request concurrency fixture", target_name: "Phase 06 Request Item",
    target_organization_id: organizationId, target_price_minor: 1000, target_product_type: "simple",
    target_sku: `P06-${runId.slice(0, 8)}`, target_store_ids: [sourceStoreId, destinationStoreId],
    target_track_inventory: true, target_unit: "each", target_variants: [],
  }, "Product creation failed");
  await rpc(clientA, "record_inventory_adjustment_v3", {
    target_approval_request_id: null, target_note: "Phase 06 opening stock", target_operation_id: randomUUID(),
    target_organization_id: organizationId, target_product_id: productId, target_quantity_delta: 20,
    target_reason_code: "PHASE06_SEED", target_store_id: sourceStoreId, target_variant_id: null,
  }, "Opening stock failed");
  const warehouseId = await rpc(clientA, "create_supply_chain_warehouse", {
    target_code: `P06-${runId.slice(0, 6).toUpperCase()}`, target_name: "Phase 06 Warehouse",
    target_notes: "Request concurrency", target_organization_id: organizationId, target_store_id: sourceStoreId,
  }, "Warehouse creation failed");

  async function prepareRequest(quantity, suffix) {
    const requestId = await rpc(clientA, "create_stock_request", {
      target_lines: [{ product_id: productId, variant_id: null, quantity: String(quantity) }],
      target_note: `Concurrency request ${suffix}`, target_operation_id: randomUUID(),
      target_organization_id: organizationId, target_requesting_store_id: destinationStoreId,
      target_source_warehouse_id: warehouseId,
    }, "Request creation failed");
    const lineId = scalar(`select id::text from public.stock_request_lines where stock_request_id = ${sqlUuid(requestId)}`);
    await rpc(clientA, "approve_stock_request", {
      target_lines: [{ stock_request_line_id: lineId, approved_quantity: String(quantity) }],
      target_organization_id: organizationId, target_stock_request_id: requestId,
    }, "Request approval failed");
    await rpc(clientA, "start_stock_request_picking", {
      target_organization_id: organizationId, target_stock_request_id: requestId,
    }, "Request picking failed");
    return requestId;
  }

  const duplicateRequestId = await prepareRequest(4, "duplicate");
  const duplicateDispatchId = randomUUID();
  const dispatchArgs = { target_note: "Duplicate dispatch", target_operation_id: duplicateDispatchId,
    target_organization_id: organizationId, target_stock_request_id: duplicateRequestId };
  const duplicateDispatch = await Promise.all([
    rpc(clientA, "dispatch_stock_request", dispatchArgs, "Duplicate dispatch A failed"),
    rpc(clientB, "dispatch_stock_request", dispatchArgs, "Duplicate dispatch B failed"),
  ]);
  assert(new Set(duplicateDispatch).size === 1, "Duplicate dispatch did not replay one transfer identity.");
  const transferId = duplicateDispatch[0];
  assert(number(`select count(*) from public.stock_transfers where stock_request_id = ${sqlUuid(duplicateRequestId)}`) === 1, "Duplicate dispatch created multiple transfers.");
  assert(number(`select count(*) from public.inventory_movements where source_type='stock_transfer' and source_id=${sqlUuid(transferId)} and movement_type='TRANSFER_OUT'`) === 1, "Duplicate dispatch deducted source more than once.");

  const transferLineId = scalar(`select id::text from public.stock_transfer_lines where stock_transfer_id=${sqlUuid(transferId)}`);
  const receiptOperationId = randomUUID();
  const receiptArgs = { target_lines: [{ stock_transfer_line_id: transferLineId, received_quantity: "4", short_quantity: "0", discrepancy_note: null }],
    target_note: "Duplicate receipt", target_operation_id: receiptOperationId,
    target_organization_id: organizationId, target_stock_request_id: duplicateRequestId };
  const duplicateReceipt = await Promise.all([
    rpc(clientA, "receive_stock_request", receiptArgs, "Duplicate receipt A failed"),
    rpc(clientB, "receive_stock_request", receiptArgs, "Duplicate receipt B failed"),
  ]);
  assert(new Set(duplicateReceipt).size === 1, "Duplicate request receipt did not replay one result.");
  assert(number(`select count(*) from public.stock_transfer_receipts where operation_id=${sqlUuid(receiptOperationId)}`) === 1, "Duplicate receipt created multiple rows.");
  assert(number(`select count(*) from public.inventory_movements where source_type='stock_transfer_receipt' and movement_type='TRANSFER_IN' and source_id=(select id from public.stock_transfer_receipts where operation_id=${sqlUuid(receiptOperationId)})`) === 1, "Duplicate receipt credited destination more than once.");

  const competingRequestId = await prepareRequest(6, "competing");
  const competing = await Promise.allSettled([
    rpc(clientA, "dispatch_stock_request", { ...dispatchArgs, target_note: "Competing dispatch", target_operation_id: randomUUID(), target_stock_request_id: competingRequestId }, "Competing dispatch A"),
    rpc(clientB, "dispatch_stock_request", { ...dispatchArgs, target_note: "Competing dispatch", target_operation_id: randomUUID(), target_stock_request_id: competingRequestId }, "Competing dispatch B"),
  ]);
  assert(competing.filter((item) => item.status === "fulfilled").length === 1, "Competing dispatch did not produce one success.");
  assert(competing.filter((item) => item.status === "rejected").length === 1, "Competing dispatch did not reject one caller.");
  assert(number(`select count(*) from public.stock_transfers where stock_request_id=${sqlUuid(competingRequestId)}`) === 1, "Competing dispatch created multiple transfers.");

  const levels = json(`select coalesce(jsonb_agg(to_jsonb(x)),'[]')::text from (select organization_id,store_id,product_id,variant_id,quantity from public.inventory_levels) x`);
  const movements = json(`select coalesce(jsonb_agg(to_jsonb(x) order by created_at,id),'[]')::text from (select id,organization_id,store_id,product_id,variant_id,quantity_before,quantity_delta,quantity_after,created_at,operation_id,source_id,source_type from public.inventory_movements) x`);
  const reconciliation = reconcileInventoryState({ levels, movements });
  assert(reconciliation.ok, `Request concurrency left ${reconciliation.anomalyCount} reconciliation anomalies.`);

  console.log(JSON.stringify({ duplicateDispatch: "PASS", competingDispatch: "PASS", duplicateReceipt: "PASS",
    reconciliation: { anomalyCount: reconciliation.anomalyCount, movementCount: reconciliation.movementCount } }, null, 2));
  console.log("REQUEST TRANSFER CONCURRENCY EVIDENCE: PASS");
}

try { await main(); } catch (error) {
  console.error(error instanceof Error ? error.message : "Phase 06 request concurrency failed.");
  process.exit(1);
}
