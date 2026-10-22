import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Backend owns only the dynamic transfer-receipt POST mutation", async () => {
  const [route, service, environment] = await Promise.all([
    read("apps/backend/api/pos/v2/transfers/[transferId]/receive.ts"),
    read("apps/backend/src/pos/transfer-receipt-service.ts"),
    read("apps/backend/.env.example"),
  ]);
  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function (?:GET|PUT|PATCH|DELETE)/);
  assert.match(route, /TINDIO_TRANSFER_RECEIPT_MODE/);
  assert.match(service, /options\.mode \?\? ["']owned["']/);
  assert.match(service, /mode === ["']proxy["']/);
  assert.match(environment, /^TINDIO_TRANSFER_RECEIPT_MODE=owned$/m);
});

test("owned transfer receipt preserves context-first custody and exact response mapping", async () => {
  const owned = await read("apps/backend/src/pos/transfer-receipt-owned.ts");
  for (const value of [
    "POS_TRANSFER_RECEIPT_REQUEST_INVALID_MESSAGE",
    "verifyClaims", "loadCore", "IDENTITY_UNMAPPED", "ORGANIZATION_INACTIVE",
    "validateTransferReceiptId", "toTransferScopedReceiptInput",
    "validateTransferReceipt", "receive", "mapTransferReceiptRpcResult",
    '"cache-control": "private, no-store"',
  ]) assert.ok(owned.includes(value), `missing owned transfer-receipt behavior ${value}`);
  assert.ok(owned.indexOf("bearerFromRequest(request)") < owned.indexOf("loadCore(token"));
  assert.ok(owned.indexOf("loadCore(token") < owned.lastIndexOf("validateTransferReceiptId"));
  assert.ok(owned.lastIndexOf("validateTransferReceiptId") < owned.indexOf("request.json()"));
  assert.ok(owned.indexOf("request.json()") < owned.lastIndexOf("validateTransferReceipt("));
  assert.ok(owned.lastIndexOf("validateTransferReceipt(") < owned.indexOf("dependencies.receive("));
  assert.doesNotMatch(owned, /service[_-]?role|DATABASE_URL/i);
});

test("transfer-receipt runtime verifies Supabase claims and sends context and mutation RPCs only to Neon", async () => {
  const [runtime, adapter] = await Promise.all([
    read("apps/backend/src/pos/transfer-receipt-runtime.ts"),
    read("apps/backend/src/database/neon-data-api-fetch.ts"),
  ]);
  assert.match(runtime, /authClient\.auth\.getClaims\(token\)/);
  assert.match(runtime, /createNeonDataApiFetch/);
  for (const value of [
    "get_pos_bootstrap_core_v2", "POS_TRANSFER_RECEIPT_RPC",
    "toTransferReceiptRpcArguments",
  ]) assert.ok(runtime.includes(value), `missing transfer-receipt runtime operation ${value}`);
  assert.match(adapter, /rewritten\.headers\.delete\(["']apikey["']\)/);
  assert.doesNotMatch(runtime, /createPosReadRuntime|service[_-]?role|DATABASE_URL/i);
});

test("transfer-receipt rollback preserves dynamic path and body while rejecting ambient credentials", async () => {
  const proxy = await read("apps/backend/src/pos/transfer-receipt-proxy.ts");
  assert.match(proxy, /TRANSFER_RECEIPT_PATH_PATTERN/);
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

test("D35 moves transfer receipt only while clients, Web rollback, and adjacent mutations stay unchanged", async () => {
  const [webTransfer, mobileApi, refund, attendance, stockRequest, readme] = await Promise.all([
    read("src/app/api/pos/v2/transfers/[transferId]/receive/route.ts"),
    read("apps/mobile/src/lib/tindio-api.ts"),
    read("apps/backend/api/pos/v2/receipts/[receiptId]/refund.ts"),
    read("src/app/api/pos/v2/attendance/clock-in/route.ts"),
    read("src/app/api/pos/v2/stock-requests/[stockRequestId]/receive/route.ts"),
    read("apps/backend/README.md"),
  ]);
  assert.match(webTransfer, /receivePosStockTransfer\(\{ context, input \}\)/);
  assert.match(mobileApi, /request\(posTransferReceiptPath\(transferId\)/);
  for (const mutation of [refund, attendance, stockRequest]) assert.match(mutation, /export async function POST/);
  assert.doesNotMatch(mobileApi, /TINDIO_WEB_API_ORIGIN|apps\/backend/);
  assert.match(readme, /Slice D35 Backend-owned transfer receipt/);
});
