import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function functionBody(source, schema, name) {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION "${schema}"."${name}"`);
  const end = source.indexOf("\n--\n-- Name:", start + 1);
  assert.ok(start >= 0 && end > start, `missing database function ${schema}.${name}`);
  return source.slice(start, end);
}

test("transfer receipt has a focused platform-neutral shared contract", async () => {
  const [manifestSource, contract] = await Promise.all([
    read("packages/contracts/package.json"),
    read("packages/contracts/src/transfer-receipt.ts"),
  ]);
  const manifest = JSON.parse(manifestSource);
  assert.equal(manifest.exports["./transfer-receipt"].types, "./src/transfer-receipt.ts");
  for (const value of [
    "POS_TRANSFER_RECEIPT_PATH_PATTERN", "POS_TRANSFER_RECEIPT_RPC",
    "POS_TRANSFER_RECEIPT_PERMISSION", "posTransferReceiptIdSchema",
    "receiveStockTransferSchema", "posTransferReceiptPath",
    "ReceiveStockTransferValues", "TransferReceiptResult",
  ]) assert.match(contract, new RegExp(`\\b${value}\\b`));
  assert.match(contract, /\.min\(1, "Enter at least one received quantity\."\)/);
  assert.match(contract, /\.max\(100\)/);
  assert.match(contract, /Each transfer line can be received once per receipt/);
  assert.doesNotMatch(contract, /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/);
});

test("Web transfer receipt retains context-first custody, path authority, shared validation, and RPC mapping", async () => {
  const [route, service, schema] = await Promise.all([
    read("src/app/api/pos/v2/transfers/[transferId]/receive/route.ts"),
    read("src/features/inventory/pos-transfer-service.ts"),
    read("src/features/inventory/advanced-inventory-schema.ts"),
  ]);
  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function (?:GET|PUT|PATCH|DELETE)/);
  assert.ok(route.indexOf("getPosV2BusinessContext(request)") < route.indexOf("posTransferReceiptIdSchema.safeParse"));
  assert.ok(route.indexOf("posTransferReceiptIdSchema.safeParse") < route.indexOf("readPosApiJson(request)"));
  assert.ok(route.indexOf("readPosApiJson(request)") < route.indexOf("stockTransferId: id.data"));
  assert.match(schema, /@tindio\/contracts\/transfer-receipt/);
  assert.match(service, /receiveStockTransferSchema\.safeParse\(input\)/);
  assert.match(service, /hasAllInventoryCapabilities\(context, \["inventory\.transfer\.receive"\]\)/);
  assert.match(service, /supabase\.rpc\(POS_TRANSFER_RECEIPT_RPC/);
  assert.match(service, /target_operation_id/);
});

test("Backend transfer-receipt oracle is isolated and no owned route exists", async () => {
  const oracle = await read("apps/backend/src/pos/transfer-receipt-compatibility.ts");
  for (const value of [
    "TRANSFER_RECEIPT_COMPATIBILITY_CONTRACT", "validateTransferReceiptId",
    "toTransferScopedReceiptInput", "validateTransferReceipt",
    "toTransferReceiptRpcArguments", "mapTransferReceiptRpcResult",
    "TRANSFER_RECEIPT_ROUTE_MESSAGES",
  ]) assert.match(oracle, new RegExp(`\\b${value}\\b`));
  assert.doesNotMatch(oracle, /fetch\(|createPosReadRuntime|createNeonDataApiFetch|@supabase|@neon|process\.env/);
  assert.equal(
    existsSync(new URL("../apps/backend/api/pos/v2/transfers/[transferId]/receive.ts", import.meta.url)),
    false,
  );
});

test("database authority retains direct-workflow, destination employee, idempotency, locking, and stock custody", async () => {
  const baseline = await read("database/baseline/0001_tindio_baseline.sql");
  const wrapper = functionBody(baseline, "public", "receive_stock_transfer");
  const adapter = functionBody(baseline, "private", "receive_stock_transfer");
  const authority = functionBody(baseline, "private", "receive_inventory_transfer");
  const core = functionBody(baseline, "private", "receive_inventory_transfer_core");
  assert.match(wrapper, /SET "search_path" TO ''/);
  assert.match(wrapper, /private\.receive_stock_transfer/);
  assert.match(adapter, /SECURITY DEFINER/);
  assert.match(authority, /inventory\.transfer\.receive/);
  assert.match(authority, /stock_request_id is not null/);
  assert.match(core, /private\.inventory_actor\(target_organization_id, transfer\.destination_store_id\)/);
  assert.match(core, /pg_advisory_xact_lock/);
  assert.match(core, /normalized_payload = command_payload/);
  assert.match(core, /for update/);
  assert.match(core, /'TRANSFER_IN'/);
  assert.match(core, /received_quantity = received_quantity \+ received_now/);
  assert.match(core, /short_quantity = short_quantity \+ short_now/);
  assert.match(baseline, /REVOKE ALL ON FUNCTION "public"\."receive_stock_transfer"[\s\S]+?FROM PUBLIC;/);
  assert.match(baseline, /GRANT ALL ON FUNCTION "public"\."receive_stock_transfer"[\s\S]+?TO "tindio_authenticated";/);
});

test("D34 keeps transfer receipt in Web and preserves clients, deployment, auth, and adjacent mutations", async () => {
  const [mobileApi, webRoute, refund, attendance, readme] = await Promise.all([
    read("apps/mobile/src/lib/tindio-api.ts"),
    read("src/app/api/pos/v2/transfers/[transferId]/receive/route.ts"),
    read("apps/backend/api/pos/v2/receipts/[receiptId]/refund.ts"),
    read("src/app/api/pos/v2/attendance/clock-in/route.ts"),
    read("apps/backend/README.md"),
  ]);
  assert.match(mobileApi, /request\(posTransferReceiptPath\(transferId\)/);
  assert.match(mobileApi, /type TransferReceiptResult/);
  assert.match(webRoute, /receivePosStockTransfer\(\{ context, input \}\)/);
  for (const mutation of [refund, attendance]) assert.match(mutation, /export async function POST/);
  assert.doesNotMatch(mobileApi, /TINDIO_WEB_API_ORIGIN|apps\/backend/);
  assert.match(readme, /Slice D34 transfer-receipt compatibility oracle/);
  assert.match(readme, /No\s+Backend transfer-receipt route or runtime mode exists/);
});
