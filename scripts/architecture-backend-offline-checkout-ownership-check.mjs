import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Backend owns only the direct offline-checkout POST mutation", async () => {
  const [route, service, environment] = await Promise.all([
    read("apps/backend/api/pos/v2/offline-checkout.ts"),
    read("apps/backend/src/pos/offline-checkout-service.ts"),
    read("apps/backend/.env.example"),
  ]);
  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function (?:GET|PUT|PATCH|DELETE)/);
  assert.match(route, /TINDIO_OFFLINE_CHECKOUT_MODE/);
  assert.match(service, /options\.mode \?\? ["']owned["']/);
  assert.match(service, /mode === ["']proxy["']/);
  assert.match(environment, /^TINDIO_OFFLINE_CHECKOUT_MODE=owned$/m);
});

test("owned offline checkout preserves context-first sequencing and ambiguity safety", async () => {
  const owned = await read("apps/backend/src/pos/offline-checkout-owned.ts");
  for (const value of [
    "POS_OFFLINE_CHECKOUT_INVALID_MESSAGE", "POS_OFFLINE_CHECKOUT_UNCONFIRMED_MESSAGE",
    "verifyClaims", "loadCore", "IDENTITY_UNMAPPED", "ORGANIZATION_INACTIVE",
    "offlineSequenceIntent", "validateDevice", "reserveSequence",
    "validateOfflineCheckout", "loadPaymentMethod", "validateOfflinePaymentMethod",
    "checkout", "loadStockWarning", "offlineSequenceFinalState", "finalizeSequence",
    "shouldRecordOfflineOutcome", "recordOutcome", "offlineCheckoutResponseStatus",
    '"cache-control": "private, no-store"',
  ]) assert.ok(owned.includes(value), `missing owned offline behavior ${value}`);
  assert.ok(owned.indexOf("bearerFromRequest(request)") < owned.indexOf("loadCore(token"));
  assert.ok(owned.indexOf("loadCore(token") < owned.indexOf("request.json()"));
  assert.ok(owned.indexOf("offlineSequenceIntent(body)") < owned.indexOf("validateOfflineCheckout(body"));
  assert.ok(owned.indexOf("reserveSequence(") < owned.indexOf("validateOfflineCheckout(body"));
  assert.ok(owned.indexOf("validateOfflineCheckout(body") < owned.indexOf("loadPaymentMethod("));
  assert.ok(owned.indexOf("loadPaymentMethod(") < owned.indexOf("dependencies.checkout("));
  assert.match(owned, /return unconfirmedResponse\(\)/);
  assert.doesNotMatch(owned, /service[_-]?role|DATABASE_URL/i);
});

test("offline-checkout runtime verifies Supabase claims and mutates only through Neon", async () => {
  const [runtime, adapter] = await Promise.all([
    read("apps/backend/src/pos/offline-checkout-runtime.ts"),
    read("apps/backend/src/database/neon-data-api-fetch.ts"),
  ]);
  assert.match(runtime, /authClient\.auth\.getClaims\(token\)/);
  assert.match(runtime, /createNeonDataApiFetch/);
  for (const value of [
    "get_pos_bootstrap_core_v2", "POS_OFFLINE_CHECKOUT_DEVICE_RPC",
    "POS_OFFLINE_CHECKOUT_RESERVE_RPC", "payment_methods", "POS_CHECKOUT_RPC",
    "POS_CHECKOUT_STOCK_WARNING_RPC", "POS_OFFLINE_CHECKOUT_FINALIZE_RPC",
    "POS_OFFLINE_CHECKOUT_RECORD_RPC",
  ]) assert.ok(runtime.includes(value), `missing offline runtime operation ${value}`);
  for (const header of [
    "x-tindio-device-id", "x-tindio-device-secret", "x-tindio-app-version",
  ]) assert.match(runtime, new RegExp(`["']${header}["']`));
  assert.match(adapter, /rewritten\.headers\.delete\(["']apikey["']\)/);
  assert.doesNotMatch(runtime, /service[_-]?role|DATABASE_URL/i);
});

test("offline-checkout rollback preserves body and rejects ambient credentials", async () => {
  const proxy = await read("apps/backend/src/pos/offline-checkout-proxy.ts");
  assert.match(proxy, /POS_OFFLINE_CHECKOUT_PATH/);
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

test("D29 moves direct offline checkout only while sync push and adjacent mutations stay in Web", async () => {
  const [webOffline, webReplay, mobileApi, sync, refund, transfer, attendance, readme] =
    await Promise.all([
      read("src/app/api/pos/v2/offline-checkout/route.ts"),
      read("src/features/offline/offline-sync.ts"),
      read("apps/mobile/src/lib/tindio-api.ts"),
      read("src/app/api/pos/v2/sync/push/route.ts"),
      read("src/app/api/pos/v2/receipts/[receiptId]/refund/route.ts"),
      read("src/app/api/pos/v2/transfers/[transferId]/receive/route.ts"),
      read("src/app/api/pos/v2/attendance/clock-in/route.ts"),
      read("apps/backend/README.md"),
    ]);
  assert.match(webOffline, /export async function POST/);
  assert.match(webReplay, /fetchPosV2Command\(POS_OFFLINE_CHECKOUT_PATH/);
  assert.match(mobileApi, /request\("\/api\/pos\/v2\/sync\/push"/);
  assert.match(sync, /processPosV2OfflineCheckout/);
  for (const mutation of [refund, transfer, attendance]) assert.match(mutation, /export async function POST/);
  assert.doesNotMatch(mobileApi, /TINDIO_WEB_API_ORIGIN|apps\/backend/);
  assert.match(readme, /Slice D29 Backend-owned offline checkout/);
});
