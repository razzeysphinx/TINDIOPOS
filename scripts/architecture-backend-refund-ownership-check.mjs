import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Backend owns only the dynamic refund POST mutation", async () => {
  const [route, service, environment] = await Promise.all([
    read("apps/backend/api/pos/v2/receipts/[receiptId]/refund.ts"),
    read("apps/backend/src/pos/refund-service.ts"),
    read("apps/backend/.env.example"),
  ]);
  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function (?:GET|PUT|PATCH|DELETE)/);
  assert.match(route, /TINDIO_REFUND_MODE/);
  assert.match(service, /options\.mode \?\? ["']owned["']/);
  assert.match(service, /mode === ["']proxy["']/);
  assert.match(environment, /^TINDIO_REFUND_MODE=owned$/m);
});

test("owned refund preserves context-first receipt custody, approval, and exact response mapping", async () => {
  const owned = await read("apps/backend/src/pos/refund-owned.ts");
  for (const value of [
    "POS_REFUND_DATABASE_MESSAGE", "POS_REFUND_RECEIPT_UNAVAILABLE_MESSAGE",
    "POS_REFUND_REQUEST_INVALID_MESSAGE", "verifyClaims", "loadCore",
    "IDENTITY_UNMAPPED", "ORGANIZATION_INACTIVE", "validateRefundReceiptId",
    "loadReceiptDetail", "saleIdFromReceipt", "toReceiptScopedRefundInput",
    "validateRefundSale", "refund", "mapRefundRpcResult",
    '"cache-control": "private, no-store"',
  ]) assert.ok(owned.includes(value), `missing owned refund behavior ${value}`);
  assert.ok(owned.indexOf("bearerFromRequest(request)") < owned.indexOf("loadCore(token"));
  assert.ok(owned.indexOf("loadCore(token") < owned.lastIndexOf("validateRefundReceiptId"));
  assert.ok(owned.lastIndexOf("validateRefundReceiptId") < owned.indexOf("request.json()"));
  assert.ok(owned.indexOf("request.json()") < owned.indexOf("dependencies.loadReceiptDetail("));
  assert.ok(owned.indexOf("saleIdFromReceipt") < owned.indexOf("validateRefundSale("));
  assert.ok(owned.lastIndexOf("validateRefundSale(") < owned.indexOf("dependencies.refund("));
  assert.doesNotMatch(owned, /service[_-]?role|DATABASE_URL/i);
});

test("refund runtime verifies Supabase claims and sends custody and mutation RPCs only to Neon", async () => {
  const [runtime, adapter] = await Promise.all([
    read("apps/backend/src/pos/refund-runtime.ts"),
    read("apps/backend/src/database/neon-data-api-fetch.ts"),
  ]);
  assert.match(runtime, /authClient\.auth\.getClaims\(token\)/);
  assert.match(runtime, /createNeonDataApiFetch/);
  for (const value of [
    "get_pos_bootstrap_core_v2", "get_pos_receipt_detail", "POS_REFUND_RPC",
    "toRefundRpcArguments",
  ]) assert.ok(runtime.includes(value), `missing refund runtime operation ${value}`);
  assert.match(adapter, /rewritten\.headers\.delete\(["']apikey["']\)/);
  assert.doesNotMatch(runtime, /createPosReadRuntime|service[_-]?role|DATABASE_URL/i);
});

test("refund rollback preserves dynamic path and body while rejecting ambient credentials", async () => {
  const proxy = await read("apps/backend/src/pos/refund-proxy.ts");
  assert.match(proxy, /POS_REFUND_PATH_PATTERN/);
  assert.match(proxy, /url\.search = requestUrl\.search/);
  assert.match(proxy, /upstream\.origin === requestUrl\.origin/);
  assert.match(proxy, /method:\s*["']POST["']/);
  assert.match(proxy, /body:\s*await request\.arrayBuffer\(\)/);
  assert.match(proxy, /redirect:\s*["']manual["']/);
  assert.match(proxy, /cache:\s*["']no-store["']/);
  for (const header of [
    "accept", "authorization", "content-type", "x-tindio-organization-id",
    "cache-control", "retry-after", "x-tindio-request-id",
  ]) assert.match(proxy, new RegExp(`["']${header}["']`));
  assert.doesNotMatch(proxy, /headers\s*:\s*request\.headers|["']cookie["']|["']x-tindio-device-secret["']/);
});

test("D33 moves refund only while clients, Web rollback, and adjacent mutations stay unchanged", async () => {
  const [webRefund, webAction, mobileApi, transfer, attendance, readme] = await Promise.all([
    read("src/app/api/pos/v2/receipts/[receiptId]/refund/route.ts"),
    read("src/features/receipts/actions.ts"),
    read("apps/mobile/src/lib/tindio-api.ts"),
    read("src/app/api/pos/v2/transfers/[transferId]/receive/route.ts"),
    read("src/app/api/pos/v2/attendance/clock-in/route.ts"),
    read("apps/backend/README.md"),
  ]);
  assert.match(webRefund, /refundSale\(\{ context, input \}\)/);
  assert.match(webAction, /refundSale\(\{ context, input \}\)/);
  assert.match(mobileApi, /request\(posRefundPath\(receiptId\)/);
  for (const mutation of [transfer, attendance]) assert.match(mutation, /export async function POST/);
  assert.doesNotMatch(mobileApi, /TINDIO_WEB_API_ORIGIN|apps\/backend/);
  assert.match(readme, /Slice D33 Backend-owned refund/);
});
