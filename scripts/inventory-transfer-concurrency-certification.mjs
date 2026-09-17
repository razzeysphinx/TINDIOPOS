import { randomUUID } from "node:crypto";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

import { reconcileInventoryState } from "./lib/inventory-reconciliation.mjs";
import { parseAndValidateLocalSupabaseStatus } from "./lib/certification-safety.mjs";
import { runCommand } from "./lib/run-command.mjs";

const ROOT = process.cwd();
const REQUEST_TIMEOUT_MS = 20_000;
const EXPECTED_LOCAL_DB_CONTAINER = "supabase_db_tindio_pos";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(message) {
  throw new Error(message);
}

function assertCondition(condition, message) {
  if (!condition) fail(message);
}

function safeErrorMessage(error) {
  const code = error && typeof error.code === "string" ? error.code : "unknown";
  const message = error && typeof error.message === "string" ? error.message : "request failed";
  return `${code}: ${message}`;
}

async function withTimeout(promise, label) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out.`)), REQUEST_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function localSupabaseStatus() {
  const result = runCommand(
    "pnpm",
    ["exec", "supabase", "status", "--output", "json"],
    { cwd: ROOT, env: process.env, capture: true },
  );
  if (result.error || result.status !== 0) fail("Unable to read local Supabase status.");

  const output = result.stdout ?? "";
  parseAndValidateLocalSupabaseStatus(output);

  let status;
  try {
    status = JSON.parse(output);
  } catch {
    fail("Local Supabase status JSON could not be parsed.");
  }
  for (const field of ["API_URL", "DB_URL", "ANON_KEY", "SERVICE_ROLE_KEY"]) {
    if (typeof status[field] !== "string" || status[field].trim() === "") {
      fail(`Local Supabase status is missing ${field}.`);
    }
  }
  return status;
}

function localDatabaseContainer() {
  const result = runCommand(
    "docker",
    ["ps", "--format", "{{.Names}}"],
    { cwd: ROOT, env: process.env, capture: true },
  );
  if (result.error || result.status !== 0) fail("Unable to enumerate local Docker containers for transfer evidence.");

  const matches = String(result.stdout ?? "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((name) => name.toLowerCase() === EXPECTED_LOCAL_DB_CONTAINER);
  if (matches.length !== 1) fail("Expected exactly one running local Supabase database container for TINDIO_POS.");
  return matches[0];
}

function localReadOnlySql(containerName, sql) {
  const normalized = String(sql).trim();
  if (!/^select\b/i.test(normalized)) fail("Transfer evidence accepts SELECT statements only.");

  const result = runCommand(
    "docker",
    [
      "exec",
      "-e",
      "PGOPTIONS=-c default_transaction_read_only=on",
      containerName,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-X",
      "-q",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      normalized,
    ],
    { cwd: ROOT, env: process.env, capture: true },
  );
  if (result.error || result.status !== 0) fail("Local read-only PostgreSQL transfer evidence query failed.");
  return String(result.stdout ?? "").trim();
}

function sqlUuid(value, label) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) fail(`${label} is not a valid UUID.`);
  return `'${value}'::uuid`;
}

function localScalar(containerName, sql, label) {
  const rows = localReadOnlySql(containerName, sql)
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (rows.length !== 1) fail(`${label} did not return exactly one row.`);
  return rows[0];
}

function localScalarNumber(containerName, sql, label) {
  const value = Number(localScalar(containerName, sql, label));
  if (!Number.isFinite(value)) fail(`${label} returned a non-numeric value.`);
  return value;
}

function localJsonQuery(containerName, sql, label) {
  const output = localReadOnlySql(containerName, sql);
  if (output === "") fail(`${label} returned no JSON payload.`);
  try {
    const parsed = JSON.parse(output);
    if (!Array.isArray(parsed)) fail(`${label} did not return a JSON array.`);
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message.includes("did not return")) throw error;
    fail(`${label} returned invalid JSON.`);
  }
}

function createLocalClient(apiUrl, key) {
  return createClient(apiUrl, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

async function rpc(client, functionName, args, label) {
  const { data, error } = await client.rpc(functionName, args);
  if (error) {
    const wrapped = new Error(`${label}: ${safeErrorMessage(error)}`);
    wrapped.code = error.code;
    throw wrapped;
  }
  return data;
}

async function signIn(client, email, password, label) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) fail(`${label}: ${safeErrorMessage(error)}`);
  assertCondition(Boolean(data.session), `${label}: no authenticated session was returned.`);
}

function projectedQuantity({ containerName, organizationId, storeId, productId }) {
  return localScalarNumber(
    containerName,
    `
      select level.quantity::text
      from public.inventory_levels level
      where level.organization_id = ${sqlUuid(organizationId, "organizationId")}
        and level.store_id = ${sqlUuid(storeId, "storeId")}
        and level.product_id = ${sqlUuid(productId, "productId")}
        and level.variant_id is null
      limit 2
    `,
    "Transfer stock projection",
  );
}

function transferRowsForOperations({ containerName, organizationId, operationIds }) {
  const operationList = operationIds.map((value, index) => sqlUuid(value, `operationIds[${index}]`)).join(", ");
  return localJsonQuery(
    containerName,
    `
      select coalesce(
        jsonb_agg(
          jsonb_build_object('id', transfer.id, 'status', transfer.status, 'operation_id', transfer.operation_id)
          order by transfer.id
        ),
        '[]'::jsonb
      )::text
      from public.stock_transfers transfer
      where transfer.organization_id = ${sqlUuid(organizationId, "organizationId")}
        and transfer.operation_id in (${operationList})
    `,
    "Transfer operation evidence",
  );
}

function transferLineId({ containerName, organizationId, transferId }) {
  const value = localScalar(
    containerName,
    `
      select line.id::text
      from public.stock_transfer_lines line
      where line.organization_id = ${sqlUuid(organizationId, "organizationId")}
        and line.stock_transfer_id = ${sqlUuid(transferId, "transferId")}
      limit 2
    `,
    "Transfer line identity",
  );
  if (!UUID_PATTERN.test(value)) fail("Transfer line evidence is not a UUID.");
  return value;
}

function transferMovementCount({ containerName, organizationId, transferId, movementType }) {
  return localScalarNumber(
    containerName,
    `
      select count(*)::text
      from public.inventory_movements movement
      where movement.organization_id = ${sqlUuid(organizationId, "organizationId")}
        and movement.source_type = 'stock_transfer'
        and movement.source_id = ${sqlUuid(transferId, "transferId")}
        and movement.movement_type = '${movementType}'
    `,
    "Transfer movement count",
  );
}

function receiptEvidence({ containerName, organizationId, transferId, operationId }) {
  return localJsonQuery(
    containerName,
    `
      select coalesce(
        jsonb_agg(jsonb_build_object('id', receipt.id, 'operation_id', receipt.operation_id) order by receipt.id),
        '[]'::jsonb
      )::text
      from public.stock_transfer_receipts receipt
      where receipt.organization_id = ${sqlUuid(organizationId, "organizationId")}
        and receipt.stock_transfer_id = ${sqlUuid(transferId, "transferId")}
        and receipt.operation_id = ${sqlUuid(operationId, "operationId")}
    `,
    "Transfer receipt evidence",
  );
}

function receiptMovementCount({ containerName, organizationId, receiptId }) {
  return localScalarNumber(
    containerName,
    `
      select count(*)::text
      from public.inventory_movements movement
      where movement.organization_id = ${sqlUuid(organizationId, "organizationId")}
        and movement.source_type = 'stock_transfer_receipt'
        and movement.source_id = ${sqlUuid(receiptId, "receiptId")}
        and movement.movement_type = 'TRANSFER_IN'
    `,
    "Receipt movement count",
  );
}

function allReconciliationRows(containerName) {
  const levels = localJsonQuery(
    containerName,
    `
      select coalesce(
        jsonb_agg(to_jsonb(snapshot) order by snapshot.organization_id, snapshot.store_id, snapshot.product_id, snapshot.variant_id nulls first),
        '[]'::jsonb
      )::text
      from (
        select organization_id, store_id, product_id, variant_id, quantity
        from public.inventory_levels
      ) snapshot
    `,
    "Inventory projection snapshot",
  );
  const movements = localJsonQuery(
    containerName,
    `
      select coalesce(
        jsonb_agg(to_jsonb(snapshot) order by snapshot.organization_id, snapshot.store_id, snapshot.product_id, snapshot.variant_id nulls first, snapshot.created_at, snapshot.id),
        '[]'::jsonb
      )::text
      from (
        select id, organization_id, store_id, product_id, variant_id,
          quantity_before, quantity_delta, quantity_after, created_at,
          operation_id, source_id, source_type
        from public.inventory_movements
      ) snapshot
    `,
    "Inventory ledger snapshot",
  );
  return { levels, movements };
}

function directTransferArgs({ organizationId, sourceStoreId, destinationStoreId, productId, operationId }) {
  return {
    target_destination_store_id: destinationStoreId,
    target_lines: [{ product_id: productId, variant_id: null, quantity: "6" }],
    target_note: "Phase 05 competing direct dispatch.",
    target_operation_id: operationId,
    target_organization_id: organizationId,
    target_source_store_id: sourceStoreId,
  };
}

async function main() {
  console.log("TINDIO CANONICAL TRANSFER CONCURRENCY EVIDENCE");
  console.log("==============================================");

  const status = localSupabaseStatus();
  const containerName = localDatabaseContainer();
  const authAdmin = createLocalClient(status.API_URL, status.SERVICE_ROLE_KEY);
  const clientA = createLocalClient(status.API_URL, status.ANON_KEY);
  const clientB = createLocalClient(status.API_URL, status.ANON_KEY);
  const runId = randomUUID();
  const email = `phase05-${runId}@tindio.test`;
  const password = `Tindio-Phase05-${randomUUID()}!`;

  const { data: createdUser, error: createUserError } = await authAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "Phase 05 Transfer Concurrency Owner" },
  });
  if (createUserError) fail(`Unable to create local transfer user: ${safeErrorMessage(createUserError)}`);
  assertCondition(Boolean(createdUser.user), "Local transfer concurrency user was not created.");

  await Promise.all([
    signIn(clientA, email, password, "Transfer client A sign-in failed"),
    signIn(clientB, email, password, "Transfer client B sign-in failed"),
  ]);

  const bootstrapData = await rpc(
    clientA,
    "bootstrap_organization",
    {
      organization_name: `Phase 05 Transfer ${runId.slice(0, 8)}`,
      register_name: "Phase 05 Register",
      store_name: "Phase 05 Source",
    },
    "Unable to bootstrap the Phase 05 transfer organization",
  );
  const bootstrap = Array.isArray(bootstrapData) ? bootstrapData[0] : bootstrapData;
  assertCondition(Boolean(bootstrap?.organization_id && bootstrap?.store_id), "Bootstrap did not return transfer organization/store IDs.");
  const organizationId = bootstrap.organization_id;
  const sourceStoreId = bootstrap.store_id;

  const { data: destination, error: destinationError } = await clientA
    .from("stores")
    .insert({ organization_id: organizationId, name: "Phase 05 Destination", code: `P05-${runId.slice(0, 6).toUpperCase()}` })
    .select("id")
    .single();
  if (destinationError) fail(`Unable to create destination store: ${safeErrorMessage(destinationError)}`);
  const destinationStoreId = destination.id;

  await rpc(
    clientA,
    "create_inventory_adjustment_reason",
    {
      target_code: "PHASE05_SEED",
      target_movement_type: "ADJUSTMENT",
      target_name: "Phase 05 transfer fixture",
      target_organization_id: organizationId,
    },
    "Unable to create the transfer adjustment reason",
  );

  const uniqueDigits = Date.now().toString().slice(-12);
  const productId = await rpc(
    clientA,
    "create_catalog_product",
    {
      target_barcode: `8${uniqueDigits}`,
      target_category_id: null,
      target_cost_minor: 500,
      target_description: "Phase 05 competing transfer fixture.",
      target_name: "Phase 05 Transfer Item",
      target_organization_id: organizationId,
      target_price_minor: 1000,
      target_product_type: "simple",
      target_sku: `PHASE05-${runId.slice(0, 8)}`,
      target_store_ids: [sourceStoreId, destinationStoreId],
      target_track_inventory: true,
      target_unit: "each",
      target_variants: [],
    },
    "Unable to create the Phase 05 tracked product",
  );

  await rpc(
    clientA,
    "record_inventory_adjustment_v3",
    {
      target_approval_request_id: null,
      target_note: "Phase 05 opening stock fixture.",
      target_operation_id: randomUUID(),
      target_organization_id: organizationId,
      target_product_id: productId,
      target_quantity_delta: 10,
      target_reason_code: "PHASE05_SEED",
      target_store_id: sourceStoreId,
      target_variant_id: null,
    },
    "Unable to seed Phase 05 opening stock",
  );
  assertCondition(projectedQuantity({ containerName, organizationId, storeId: sourceStoreId, productId }) === 10, "Opening source stock is not ten.");
  assertCondition(projectedQuantity({ containerName, organizationId, storeId: destinationStoreId, productId }) === 0, "Opening destination stock is not zero.");

  const dispatchOperationA = randomUUID();
  const dispatchOperationB = randomUUID();
  const competingResults = await Promise.allSettled([
    withTimeout(
      rpc(clientA, "create_direct_stock_transfer", directTransferArgs({ organizationId, sourceStoreId, destinationStoreId, productId, operationId: dispatchOperationA }), "Competing dispatch A failed"),
      "Competing dispatch A",
    ),
    withTimeout(
      rpc(clientB, "create_direct_stock_transfer", directTransferArgs({ organizationId, sourceStoreId, destinationStoreId, productId, operationId: dispatchOperationB }), "Competing dispatch B failed"),
      "Competing dispatch B",
    ),
  ]);
  const dispatchSuccesses = competingResults.filter((result) => result.status === "fulfilled");
  const dispatchFailures = competingResults.filter((result) => result.status === "rejected");
  assertCondition(dispatchSuccesses.length === 1 && dispatchFailures.length === 1, "Competing transfers must produce exactly one dispatch and one rejection.");
  assertCondition(projectedQuantity({ containerName, organizationId, storeId: sourceStoreId, productId }) === 4, "Competing dispatch serialization produced the wrong source quantity.");
  assertCondition(projectedQuantity({ containerName, organizationId, storeId: destinationStoreId, productId }) === 0, "Dispatch incorrectly changed destination stock.");

  const transferRows = transferRowsForOperations({ containerName, organizationId, operationIds: [dispatchOperationA, dispatchOperationB] });
  assertCondition(transferRows.length === 1 && transferRows[0].status === "dispatched", "Competing dispatches did not leave exactly one dispatched transfer.");
  const transferId = transferRows[0].id;
  assertCondition(transferMovementCount({ containerName, organizationId, transferId, movementType: "TRANSFER_OUT" }) === 1, "Competing dispatches wrote an unexpected number of TRANSFER_OUT movements.");

  const lineId = transferLineId({ containerName, organizationId, transferId });
  const receiptOperationId = randomUUID();
  const receiptArgs = {
    target_lines: [{ stock_transfer_line_id: lineId, received_quantity: "6", short_quantity: "0", discrepancy_note: null }],
    target_note: "Phase 05 concurrent duplicate receipt.",
    target_operation_id: receiptOperationId,
    target_organization_id: organizationId,
    target_stock_transfer_id: transferId,
  };
  const receiptResults = await Promise.allSettled([
    withTimeout(rpc(clientA, "receive_stock_transfer", receiptArgs, "Duplicate receipt A failed"), "Duplicate receipt A"),
    withTimeout(rpc(clientB, "receive_stock_transfer", receiptArgs, "Duplicate receipt B failed"), "Duplicate receipt B"),
  ]);
  assertCondition(receiptResults.every((result) => result.status === "fulfilled"), "Concurrent duplicate receipts must both resolve successfully.");
  const receiptIds = receiptResults.map((result) => result.status === "fulfilled" ? result.value : null);
  assertCondition(new Set(receiptIds).size === 1, "Concurrent duplicate receipts did not resolve to one receipt identity.");
  assertCondition(projectedQuantity({ containerName, organizationId, storeId: destinationStoreId, productId }) === 6, "Concurrent duplicate receipt credited destination more than once.");

  const receipts = receiptEvidence({ containerName, organizationId, transferId, operationId: receiptOperationId });
  assertCondition(receipts.length === 1, "Concurrent duplicate receipt created duplicate receipt rows.");
  assertCondition(receiptMovementCount({ containerName, organizationId, receiptId: receipts[0].id }) === 1, "Concurrent duplicate receipt created duplicate TRANSFER_IN movements.");

  const { levels, movements } = allReconciliationRows(containerName);
  const reconciliation = reconcileInventoryState({ levels, movements });
  if (!reconciliation.ok) {
    console.error(JSON.stringify({ anomalyCount: reconciliation.anomalyCount, anomalyCounts: reconciliation.anomalyCounts, sample: reconciliation.anomalies.slice(0, 10) }, null, 2));
    fail("Transfer concurrency left ledger/projection reconciliation anomalies.");
  }

  console.log(JSON.stringify({
    competingDispatch: {
      startingSource: 10,
      requestedPerCaller: 6,
      successes: dispatchSuccesses.length,
      rejections: dispatchFailures.length,
      finalSource: 4,
      finalDestinationBeforeReceipt: 0,
      dispatchedTransfers: transferRows.length,
      transferOutMovements: 1,
    },
    duplicateReceipt: {
      successfulCallers: receiptResults.length,
      sameReceiptId: new Set(receiptIds).size === 1,
      finalDestination: 6,
      receiptRows: receipts.length,
      transferInMovements: 1,
    },
    reconciliation: {
      projectionKeyCount: reconciliation.projectionKeyCount,
      ledgerKeyCount: reconciliation.ledgerKeyCount,
      movementCount: reconciliation.movementCount,
      anomalyCounts: reconciliation.anomalyCounts,
      anomalyCount: reconciliation.anomalyCount,
    },
  }, null, 2));
  console.log("CANONICAL TRANSFER CONCURRENCY EVIDENCE: PASS");
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Phase 05 transfer evidence failed.");
  process.exit(1);
}
