import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Backend owns only the sale-exchange link POST mutation", async () => {
  const [route, service, environment, contract] = await Promise.all([
    read("apps/backend/api/pos/v2/exchanges/link.ts"),
    read("apps/backend/src/pos/sale-exchange-service.ts"),
    read("apps/backend/.env.example"),
    read("packages/contracts/src/sale-exchange.ts"),
  ]);
  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function (?:GET|PUT|PATCH|DELETE)/);
  assert.match(route, /TINDIO_SALE_EXCHANGE_MODE/);
  assert.match(service, /options\.mode \?\? ["']owned["']/);
  assert.match(service, /mode === ["']proxy["']/);
  assert.match(environment, /^TINDIO_SALE_EXCHANGE_MODE=owned$/m);
  assert.match(contract, /POS_SALE_EXCHANGE_PATH = "\/api\/pos\/v2\/exchanges\/link"/);
});

test("owned sale exchange preserves context-first authorization and exact response mapping", async () => {
  const owned = await read("apps/backend/src/pos/sale-exchange-owned.ts");
  for (const value of [
    "POS_SALE_EXCHANGE_REQUEST_INVALID_MESSAGE", "verifyClaims", "loadCore",
    "IDENTITY_UNMAPPED", "ORGANIZATION_INACTIVE", "validateSaleExchange",
    "link", "mapSaleExchangeRpcResult", '"cache-control": "private, no-store"',
  ]) assert.ok(owned.includes(value), `missing owned sale-exchange behavior ${value}`);
  assert.ok(owned.indexOf("bearerFromRequest(request)") < owned.indexOf("loadCore(token"));
  assert.ok(owned.indexOf("loadCore(token") < owned.indexOf("request.json()"));
  assert.ok(owned.indexOf("request.json()") < owned.indexOf("validateSaleExchange(body"));
  assert.ok(owned.indexOf("validateSaleExchange(body") < owned.indexOf("dependencies.link("));
  assert.doesNotMatch(owned, /service[_-]?role|DATABASE_URL/i);
});

test("sale-exchange runtime verifies Supabase claims and sends context and mutation RPCs only to Neon", async () => {
  const [runtime, adapter] = await Promise.all([
    read("apps/backend/src/pos/sale-exchange-runtime.ts"),
    read("apps/backend/src/database/neon-data-api-fetch.ts"),
  ]);
  assert.match(runtime, /authClient\.auth\.getClaims\(token\)/);
  assert.match(runtime, /createNeonDataApiFetch/);
  for (const value of [
    "get_pos_bootstrap_core_v2", "POS_SALE_EXCHANGE_RPC", "toSaleExchangeRpcArguments",
  ]) assert.ok(runtime.includes(value), `missing sale-exchange runtime operation ${value}`);
  assert.match(adapter, /rewritten\.headers\.delete\(["']apikey["']\)/);
  assert.doesNotMatch(runtime, /createPosReadRuntime|service[_-]?role|DATABASE_URL/i);
});

test("sale-exchange rollback preserves path and body while rejecting ambient credentials", async () => {
  const proxy = await read("apps/backend/src/pos/sale-exchange-proxy.ts");
  assert.match(proxy, /POS_SALE_EXCHANGE_PATH/);
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

test("D39 moves sale exchange only while the Server Action and adjacent boundaries remain", async () => {
  const [webRoute, action, settingsSchema, attendance, refund, backendReadme] = await Promise.all([
    read("src/app/api/pos/v2/exchanges/link/route.ts"),
    read("src/features/receipts/improvement-6-actions.ts"),
    read("src/features/receipts/improvement-6-schema.ts"),
    read("apps/backend/api/pos/v2/attendance/clock-in.ts"),
    read("apps/backend/api/pos/v2/receipts/[receiptId]/refund.ts"),
    read("apps/backend/README.md"),
  ]);
  assert.match(webRoute, /getPosV2BusinessContext\(request\)/);
  assert.match(webRoute, /linkSaleExchange\(\{ context: resolved\.context, input: body\.input \}\)/);
  assert.match(action, /export async function linkSaleExchangeAction/);
  assert.match(action, /linkSaleExchange\(\{ context, input \}\)/);
  assert.match(settingsSchema, /\breceiptSettingsSchema\b/);
  for (const mutation of [attendance, refund]) assert.match(mutation, /export async function POST/);
  assert.match(backendReadme, /Slice D39 Backend-owned sale exchange/);
});
