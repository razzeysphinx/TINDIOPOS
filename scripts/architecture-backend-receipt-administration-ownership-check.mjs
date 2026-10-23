import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Backend owns only the receipt-settings and digital-delivery POST mutations", async () => {
  const [settingsRoute, deliveryRoute, service, environment, settingsContract, deliveryContract] = await Promise.all([
    read("apps/backend/api/pos/v2/receipt-settings.ts"),
    read("apps/backend/api/pos/v2/receipts/[receiptId]/delivery.ts"),
    read("apps/backend/src/pos/receipt-administration-service.ts"),
    read("apps/backend/.env.example"),
    read("packages/contracts/src/receipt-settings.ts"),
    read("packages/contracts/src/receipt-delivery.ts"),
  ]);
  for (const route of [settingsRoute, deliveryRoute]) {
    assert.match(route, /export async function POST/);
    assert.doesNotMatch(route, /export async function (?:GET|PUT|PATCH|DELETE)/);
  }
  assert.match(settingsRoute, /TINDIO_RECEIPT_SETTINGS_MODE/);
  assert.match(deliveryRoute, /TINDIO_RECEIPT_DELIVERY_MODE/);
  assert.match(service, /options\.mode \?\? ["']owned["']/);
  assert.match(service, /mode === ["']proxy["']/);
  assert.match(environment, /^TINDIO_RECEIPT_SETTINGS_MODE=owned$/m);
  assert.match(environment, /^TINDIO_RECEIPT_DELIVERY_MODE=owned$/m);
  assert.match(settingsContract, /POS_RECEIPT_SETTINGS_PATH = "\/api\/pos\/v2\/receipt-settings"/);
  assert.match(deliveryContract, /POS_RECEIPT_DELIVERY_PATH_PATTERN/);
});

test("owned receipt administration preserves context-first authorization and exact mapping", async () => {
  const owned = await read("apps/backend/src/pos/receipt-administration-owned.ts");
  for (const value of [
    "verifyClaims", "loadCore", "IDENTITY_UNMAPPED", "ORGANIZATION_INACTIVE",
    "validateReceiptSettings", "validateReceiptDelivery", "updateSettings",
    "queueDelivery", "mapReceiptSettingsRpcResult", "mapReceiptDeliveryRpcResult",
    '"cache-control": "private, no-store"',
  ]) assert.ok(owned.includes(value), `missing owned receipt-administration behavior ${value}`);
  assert.ok(owned.indexOf("bearerFromRequest(request)") < owned.indexOf("dependencies.verifyClaims(token)"));
  assert.ok(owned.indexOf("dependencies.verifyClaims(token)") < owned.indexOf("dependencies.loadCore(token"));
  assert.doesNotMatch(owned, /service[_-]?role|DATABASE_URL/i);
});

test("receipt-administration runtime verifies Supabase claims and sends database RPCs only to Neon", async () => {
  const [runtime, adapter] = await Promise.all([
    read("apps/backend/src/pos/receipt-administration-runtime.ts"),
    read("apps/backend/src/database/neon-data-api-fetch.ts"),
  ]);
  assert.match(runtime, /authClient\.auth\.getClaims\(token\)/);
  assert.match(runtime, /createNeonDataApiFetch/);
  for (const value of [
    "get_pos_bootstrap_core_v2", "POS_RECEIPT_SETTINGS_RPC", "POS_RECEIPT_DELIVERY_RPC",
    "toReceiptSettingsRpcArguments", "toReceiptDeliveryRpcArguments",
  ]) assert.ok(runtime.includes(value), `missing receipt-administration runtime operation ${value}`);
  assert.match(adapter, /rewritten\.headers\.delete\(["']apikey["']\)/);
  assert.doesNotMatch(runtime, /service[_-]?role|DATABASE_URL/i);
});

test("receipt-administration rollback preserves both paths and bodies while rejecting ambient credentials", async () => {
  const proxy = await read("apps/backend/src/pos/receipt-administration-proxy.ts");
  assert.match(proxy, /POS_RECEIPT_SETTINGS_PATH/);
  assert.match(proxy, /POS_RECEIPT_DELIVERY_PATH_PATTERN/);
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

test("D41 moves only receipt administration while rollback and adjacent boundaries remain", async () => {
  const [settingsWebRoute, deliveryWebRoute, action, exchange, shifts, backendReadme] = await Promise.all([
    read("src/app/api/pos/v2/receipt-settings/route.ts"),
    read("src/app/api/pos/v2/receipts/[receiptId]/delivery/route.ts"),
    read("src/features/receipts/improvement-6-actions.ts"),
    read("apps/backend/api/pos/v2/exchanges/link.ts"),
    read("src/app/api/pos/v2/shifts/open/route.ts"),
    read("apps/backend/README.md"),
  ]);
  assert.match(settingsWebRoute, /getPosV2BusinessContext\(request\)/);
  assert.match(settingsWebRoute, /updateReceiptSettings\(\{ context: resolved\.context, input: body\.input \}\)/);
  assert.match(deliveryWebRoute, /queueReceiptDelivery\(\{ context, input \}\)/);
  assert.match(action, /export async function updateReceiptSettingsAction/);
  assert.match(action, /export async function queueReceiptDeliveryAction/);
  assert.match(exchange, /export async function POST/);
  assert.match(shifts, /openShift\(\{ context, input: body\.input \}\)/);
  assert.match(backendReadme, /Slice D41 Backend-owned receipt administration/);
});
