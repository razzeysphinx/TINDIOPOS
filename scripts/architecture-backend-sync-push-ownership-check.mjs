import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Backend owns only the sync-push POST mutation", async () => {
  const [route, service, environment] = await Promise.all([
    read("apps/backend/api/pos/v2/sync/push.ts"),
    read("apps/backend/src/pos/sync-push-service.ts"),
    read("apps/backend/.env.example"),
  ]);
  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function (?:GET|PUT|PATCH|DELETE)/);
  assert.match(route, /TINDIO_SYNC_PUSH_MODE/);
  assert.match(service, /options\.mode \?\? ["']owned["']/);
  assert.match(service, /mode === ["']proxy["']/);
  assert.match(environment, /^TINDIO_SYNC_PUSH_MODE=owned$/m);
});

test("owned sync push preserves context, custody, ordering, acknowledgements, and stop behavior", async () => {
  const owned = await read("apps/backend/src/pos/sync-push-owned.ts");
  for (const value of [
    "POS_SYNC_PUSH_INVALID_MESSAGE", "POS_SYNC_PUSH_DEVICE_MESSAGE",
    "POS_SYNC_PUSH_UNAVAILABLE_MESSAGE", "verifyClaims", "loadCore",
    "IDENTITY_UNMAPPED", "ORGANIZATION_INACTIVE", "validateSyncPushRequest",
    "validateSyncPushBatch", "validateDevice", "mapSyncPushDevice",
    "toSyncPushOfflineSubmission", "processOfflineCheckout", "createSyncPushAck",
    "shouldStopSyncPush", "createSyncPushResponse",
    '"cache-control": "private, no-store"',
  ]) assert.ok(owned.includes(value), `missing owned sync-push behavior ${value}`);
  assert.ok(owned.indexOf("bearerFromRequest(request)") < owned.indexOf("loadCore(token"));
  assert.ok(owned.indexOf("loadCore(token") < owned.indexOf("request.json()"));
  assert.ok(owned.indexOf("validateSyncPushBatch(input)") < owned.indexOf("validateDevice("));
  assert.ok(owned.indexOf("validateDevice(") < owned.indexOf("for (const event of input.events)"));
  assert.ok(owned.indexOf("processOfflineCheckout(") < owned.indexOf("shouldStopSyncPush(ack)"));
  assert.match(owned, /if \(shouldStopSyncPush\(ack\)\) \{[\s\S]+?break;/);
  assert.doesNotMatch(owned, /service[_-]?role|DATABASE_URL/i);
});

test("sync-push runtime verifies Supabase claims once and sends database work only through Neon", async () => {
  const [runtime, adapter] = await Promise.all([
    read("apps/backend/src/pos/sync-push-runtime.ts"),
    read("apps/backend/src/database/neon-data-api-fetch.ts"),
  ]);
  assert.match(runtime, /authClient\.auth\.getClaims\(token\)/);
  assert.match(runtime, /createNeonDataApiFetch/);
  assert.match(runtime, /get_pos_bootstrap_core_v2/);
  assert.match(runtime, /POS_SYNC_PUSH_DEVICE_RPC/);
  assert.match(runtime, /createOwnedOfflineCheckoutDependencies/);
  assert.match(runtime, /handleOwnedOfflineCheckout/);
  assert.match(runtime, /verifyClaims: async \(\) => \(\{ data: \{ claims \}, error: null \}\)/);
  assert.match(runtime, /loadCore: async \(\) => \(\{ data: core, error: null \}\)/);
  for (const header of [
    "x-tindio-device-id", "x-tindio-device-secret", "x-tindio-app-version",
  ]) assert.match(runtime, new RegExp(`["']${header}["']`));
  assert.match(adapter, /rewritten\.headers\.delete\(["']apikey["']\)/);
  assert.doesNotMatch(runtime, /service[_-]?role|DATABASE_URL/i);
});

test("sync-push rollback preserves the batch body and rejects ambient credentials", async () => {
  const proxy = await read("apps/backend/src/pos/sync-push-proxy.ts");
  assert.match(proxy, /POS_SYNC_PUSH_PATH/);
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

test("D31 moves sync push only while clients, rollback, and adjacent mutations stay unchanged", async () => {
  const [webSync, mobileApi, offline, refund, transfer, attendance, readme] =
    await Promise.all([
      read("src/app/api/pos/v2/sync/push/route.ts"),
      read("apps/mobile/src/lib/tindio-api.ts"),
      read("apps/backend/api/pos/v2/offline-checkout.ts"),
      read("src/app/api/pos/v2/receipts/[receiptId]/refund/route.ts"),
      read("src/app/api/pos/v2/transfers/[transferId]/receive/route.ts"),
      read("src/app/api/pos/v2/attendance/clock-in/route.ts"),
      read("apps/backend/README.md"),
    ]);
  assert.match(webSync, /processPosV2OfflineCheckout/);
  assert.match(mobileApi, /request\("\/api\/pos\/v2\/sync\/push"/);
  assert.match(offline, /serveOfflineCheckout/);
  for (const mutation of [refund, transfer, attendance]) assert.match(mutation, /export async function POST/);
  assert.doesNotMatch(mobileApi, /TINDIO_WEB_API_ORIGIN|apps\/backend/);
  assert.match(readme, /Slice D31 Backend-owned sync push/);
});
