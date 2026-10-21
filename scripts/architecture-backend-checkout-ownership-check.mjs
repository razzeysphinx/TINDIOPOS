import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Backend owns only the online checkout POST mutation", async () => {
  const [route, service, environment] = await Promise.all([
    read("apps/backend/api/pos/v2/checkout.ts"),
    read("apps/backend/src/pos/checkout-service.ts"),
    read("apps/backend/.env.example"),
  ]);
  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function (?:GET|PUT|PATCH|DELETE)/);
  assert.match(route, /TINDIO_CHECKOUT_MODE/);
  assert.match(service, /options\.mode \?\? ["']owned["']/);
  assert.match(service, /mode === ["']proxy["']/);
  assert.match(environment, /^TINDIO_CHECKOUT_MODE=owned$/m);
});

test("owned checkout preserves JSON-first validation, context, statuses, and ambiguity safety", async () => {
  const owned = await read("apps/backend/src/pos/checkout-owned.ts");
  for (const value of [
    "POS_CHECKOUT_REQUEST_INVALID_MESSAGE", "verifyClaims", "loadCore",
    "IDENTITY_UNMAPPED", "ORGANIZATION_INACTIVE", "INVALID_BUSINESS_TYPE",
    "validateCheckout", "assignedStoreIds", "checkout", "loadStockWarning",
    "mapCheckoutRpcResult", "POS_CHECKOUT_UNCONFIRMED_MESSAGE",
    '"cache-control": "private, no-store"',
  ]) assert.ok(owned.includes(value), `missing owned behavior ${value}`);
  assert.ok(owned.indexOf("request.json()") < owned.indexOf("bearerFromRequest(request)"));
  assert.ok(owned.indexOf("loadCore") < owned.indexOf("validateCheckout(body"));
  assert.ok(owned.indexOf("validateCheckout(body") < owned.indexOf("dependencies.checkout("));
  assert.ok(owned.indexOf("dependencies.checkout(") < owned.indexOf("dependencies.loadStockWarning("));
  assert.match(owned, /validation\.result\.retryable \? 503 : 409/);
  assert.match(owned, /POS_CHECKOUT_UNCONFIRMED_MESSAGE[\s\S]+500/);
  assert.doesNotMatch(owned, /service[_-]?role|DATABASE_URL/i);
});

test("checkout runtime verifies Supabase claims and writes only through Neon", async () => {
  const [runtime, adapter] = await Promise.all([
    read("apps/backend/src/pos/checkout-runtime.ts"),
    read("apps/backend/src/database/neon-data-api-fetch.ts"),
  ]);
  assert.match(runtime, /authClient\.auth\.getClaims\(token\)/);
  assert.match(runtime, /createNeonDataApiFetch/);
  assert.match(runtime, /get_pos_bootstrap_core_v2/);
  assert.match(runtime, /POS_CHECKOUT_RPC/);
  assert.match(runtime, /POS_CHECKOUT_STOCK_WARNING_RPC/);
  for (const header of [
    "x-tindio-device-id", "x-tindio-device-secret", "x-tindio-app-version",
  ]) assert.match(runtime, new RegExp(`["']${header}["']`));
  assert.match(adapter, /rewritten\.headers\.delete\(["']apikey["']\)/);
  assert.doesNotMatch(runtime, /service[_-]?role|DATABASE_URL/i);
});

test("checkout rollback preserves body and rejects ambient credentials", async () => {
  const proxy = await read("apps/backend/src/pos/checkout-proxy.ts");
  assert.match(proxy, /POS_CHECKOUT_PATH/);
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

test("D27 moves online checkout only while high-risk adjacent mutations stay in Web", async () => {
  const [webCheckout, mobileApi, webPayment, offline, refund, transfer, attendance, sync, readme] =
    await Promise.all([
      read("src/app/api/pos/v2/checkout/route.ts"),
      read("apps/mobile/src/lib/tindio-api.ts"),
      read("src/features/checkout/payment-screen.tsx"),
      read("src/app/api/pos/v2/offline-checkout/route.ts"),
      read("src/app/api/pos/v2/receipts/[receiptId]/refund/route.ts"),
      read("src/app/api/pos/v2/transfers/[transferId]/receive/route.ts"),
      read("src/app/api/pos/v2/attendance/clock-in/route.ts"),
      read("src/app/api/pos/v2/sync/push/route.ts"),
      read("apps/backend/README.md"),
    ]);
  assert.match(webCheckout, /export async function POST/);
  assert.match(mobileApi, /request\(POS_CHECKOUT_PATH/);
  assert.match(webPayment, /fetchPosV2Command\(POS_CHECKOUT_PATH/);
  for (const mutation of [offline, refund, transfer, attendance, sync]) {
    assert.match(mutation, /export async function POST/);
  }
  assert.doesNotMatch(mobileApi, /TINDIO_WEB_API_ORIGIN|apps\/backend/);
  assert.match(readme, /Slice D27 Backend-owned checkout/);
});
