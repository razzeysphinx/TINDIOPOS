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

test("refund has a focused platform-neutral shared contract", async () => {
  const [manifestSource, contract] = await Promise.all([
    read("packages/contracts/package.json"),
    read("packages/contracts/src/refund.ts"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(manifest.exports["./refund"].types, "./src/refund.ts");
  for (const value of [
    "POS_REFUND_PATH_PATTERN", "POS_REFUND_RPC", "POS_REFUND_PERMISSION",
    "POS_REFUND_REQUEST_INVALID_MESSAGE", "POS_REFUND_RECEIPT_INVALID_MESSAGE",
    "POS_REFUND_RECEIPT_UNAVAILABLE_MESSAGE", "POS_REFUND_INPUT_MESSAGE",
    "POS_REFUND_PERMISSION_MESSAGE", "POS_REFUND_DATABASE_MESSAGE",
    "posRefundReceiptIdSchema", "refundSaleSchema", "posRefundPath",
    "RefundSaleValues", "RefundSaleResult", "RefundDatabaseRow",
  ]) assert.match(contract, new RegExp(`\\b${value}\\b`));
  assert.match(contract, /quantity: z\.number\(\)\.int\(\)\.min\(1\)\.max\(10_000\)/);
  assert.match(contract, /returnToStock: z\.boolean\(\)\.optional\(\)\.default\(true\)/);
  assert.doesNotMatch(
    contract,
    /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/,
  );
});

test("Web refund retains context-first receipt custody, shared validation, and RPC mapping", async () => {
  const [route, service, schema] = await Promise.all([
    read("src/app/api/pos/v2/receipts/[receiptId]/refund/route.ts"),
    read("src/features/receipts/service.ts"),
    read("src/features/receipts/refund-schema.ts"),
  ]);
  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function (?:GET|PUT|PATCH|DELETE)/);
  assert.ok(route.indexOf("getPosV2BusinessContext(request)") < route.indexOf("receiptIdSchema.safeParse"));
  assert.ok(route.indexOf("receiptIdSchema.safeParse") < route.indexOf("readPosApiJson(request)"));
  assert.ok(route.indexOf("readPosApiJson(request)") < route.indexOf("await loadPosReceiptDetail"));
  assert.ok(route.indexOf("await loadPosReceiptDetail") < route.indexOf("saleId: detail.sale.id"));
  assert.match(route, /refundSale\(\{ context, input \}\)/);
  assert.match(schema, /@tindio\/contracts\/refund/);
  assert.match(service, /refundSaleSchema\.safeParse\(input\)/);
  assert.match(service, /hasPermission\(context, "sales\.refund"\)/);
  assert.match(service, /supabase\.rpc\("refund_sale"/);
  assert.match(service, /target_approval_request_id/);
});

test("Backend refund oracle remains isolated beside the owned route", async () => {
  const oracle = await read("apps/backend/src/pos/refund-compatibility.ts");
  for (const value of [
    "REFUND_COMPATIBILITY_CONTRACT", "validateRefundReceiptId",
    "toReceiptScopedRefundInput", "validateRefundSale", "toRefundRpcArguments",
    "mapRefundRpcResult", "REFUND_ROUTE_MESSAGES",
  ]) assert.match(oracle, new RegExp(`\\b${value}\\b`));
  assert.doesNotMatch(
    oracle,
    /fetch\(|createPosReadRuntime|createNeonDataApiFetch|@supabase|@neon|process\.env/,
  );
  assert.equal(
    existsSync(new URL("../apps/backend/api/pos/v2/receipts/[receiptId]/refund.ts", import.meta.url)),
    true,
  );
});

test("database authority retains approval, employee-store, idempotency, payment, and stock custody", async () => {
  const baseline = await read("database/baseline/0001_tindio_baseline.sql");
  const wrapper = functionBody(baseline, "public", "refund_sale");
  const mutation = functionBody(baseline, "private", "refund_sale");

  assert.match(wrapper, /SET "search_path" TO ''/);
  assert.match(wrapper, /private\.authorize_sensitive_operation/);
  assert.match(wrapper, /'sales\.refund'/);
  assert.match(wrapper, /private\.refund_sale/);
  assert.match(mutation, /SECURITY DEFINER/);
  assert.match(mutation, /SET "search_path" TO ''/);
  assert.match(mutation, /private\.current_profile_id\(\)/);
  assert.match(mutation, /private\.has_permission\(target_organization_id, 'sales\.refund'\)/);
  assert.match(mutation, /public\.employee_stores/);
  assert.match(mutation, /for update/);
  assert.match(mutation, /existing_payload is distinct from canonical_payload/);
  assert.match(mutation, /selected_return_to_stock/);
  assert.match(mutation, /movement_type[\s\S]+?'REFUND'/);
  assert.match(mutation, /payment_method_record\.requires_reference/);
  assert.match(mutation, /public\.refund_payments/);
  assert.match(baseline, /REVOKE ALL ON FUNCTION "public"\."refund_sale"[\s\S]+?FROM PUBLIC;/);
  assert.match(baseline, /GRANT ALL ON FUNCTION "public"\."refund_sale"[\s\S]+?TO "tindio_authenticated";/);
});

test("D32 keeps refund in Web and preserves clients, deployment, auth, and adjacent mutations", async () => {
  const [mobileApi, webAction, backendReceipt, transfer, attendance, readme] = await Promise.all([
    read("apps/mobile/src/lib/tindio-api.ts"),
    read("src/features/receipts/actions.ts"),
    read("apps/backend/api/pos/v2/receipts/[receiptId].ts"),
    read("src/app/api/pos/v2/transfers/[transferId]/receive/route.ts"),
    read("src/app/api/pos/v2/attendance/clock-in/route.ts"),
    read("apps/backend/README.md"),
  ]);
  assert.match(mobileApi, /request\(posRefundPath\(receiptId\)/);
  assert.match(mobileApi, /type RefundSaleResult/);
  assert.match(webAction, /refundSale\(\{ context, input \}\)/);
  assert.match(backendReceipt, /servePosReceiptDetail/);
  for (const mutation of [transfer, attendance]) assert.match(mutation, /export async function POST/);
  assert.doesNotMatch(mobileApi, /TINDIO_WEB_API_ORIGIN|apps\/backend/);
  assert.match(readme, /Slice D32 refund compatibility oracle/);
  assert.match(readme, /No Backend\s+refund route or runtime mode exists/);
});
