import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Backend owns only the customer-display PUT mutation", async () => {
  const [route, service, environment] = await Promise.all([
    read("apps/backend/api/pos/v2/customer-display.ts"),
    read("apps/backend/src/pos/customer-display-service.ts"),
    read("apps/backend/.env.example"),
  ]);

  assert.match(route, /export async function PUT/);
  assert.doesNotMatch(route, /export async function (?:GET|POST|PATCH|DELETE)/);
  assert.match(route, /TINDIO_CUSTOMER_DISPLAY_UPDATE_MODE/);
  assert.match(service, /options\.mode \?\? ["']owned["']/);
  assert.match(service, /mode === ["']proxy["']/);
  assert.match(environment, /^TINDIO_CUSTOMER_DISPLAY_UPDATE_MODE=owned$/m);
});

test("owned customer-display preserves context, validation order, and exact response mapping", async () => {
  const owned = await read("apps/backend/src/pos/customer-display-owned.ts");

  for (const value of [
    "verifyClaims",
    "loadCore",
    "IDENTITY_UNMAPPED",
    "ORGANIZATION_INACTIVE",
    "INVALID_BUSINESS_TYPE",
    "CUSTOMER_DISPLAY_UPDATE_PERMISSIONS[0]",
    "CUSTOMER_DISPLAY_UPDATE_PERMISSIONS[1]",
    "validateCustomerDisplayUpdate",
    "updateDisplay",
    "mapCustomerDisplayRpcError",
    "status: 204",
    '"cache-control": "no-store"',
  ]) assert.ok(owned.includes(value), `missing owned behavior ${value}`);

  assert.ok(
    owned.indexOf("CUSTOMER_DISPLAY_UPDATE_PERMISSIONS[0]")
      < owned.indexOf("request.json()"),
    "permission checks must precede body parsing",
  );
  assert.ok(
    owned.indexOf("request.json()") < owned.indexOf("updateDisplay("),
    "body validation must precede the mutation",
  );
  assert.doesNotMatch(owned, /service[_-]?role|DATABASE_URL/i);
});

test("customer-display command runtime verifies Supabase claims and mutates only through Neon", async () => {
  const [runtime, adapter] = await Promise.all([
    read("apps/backend/src/pos/customer-display-runtime.ts"),
    read("apps/backend/src/database/neon-data-api-fetch.ts"),
  ]);

  assert.match(runtime, /authClient\.auth\.getClaims\(token\)/);
  assert.match(runtime, /createNeonDataApiFetch/);
  assert.match(runtime, /get_pos_bootstrap_core_v2/);
  assert.match(runtime, /CUSTOMER_DISPLAY_UPDATE_RPC/);
  for (const argument of [
    "target_organization_id",
    "target_session_id",
    "target_state",
  ]) assert.match(runtime, new RegExp(`\\b${argument}\\b`));
  assert.match(adapter, /rewritten\.headers\.delete\(["']apikey["']\)/);
  assert.doesNotMatch(runtime, /service[_-]?role|DATABASE_URL/i);
});

test("customer-display rollback preserves body and rejects loops and ambient credentials", async () => {
  const proxy = await read("apps/backend/src/pos/customer-display-proxy.ts");

  assert.match(proxy, /CUSTOMER_DISPLAY_UPDATE_PATH/);
  assert.match(proxy, /url\.search = requestUrl\.search/);
  assert.match(proxy, /upstream\.origin === requestUrl\.origin/);
  assert.match(proxy, /method:\s*["']PUT["']/);
  assert.match(proxy, /body:\s*await request\.arrayBuffer\(\)/);
  assert.match(proxy, /redirect:\s*["']manual["']/);
  assert.match(proxy, /cache:\s*["']no-store["']/);
  for (const header of [
    "accept",
    "authorization",
    "content-type",
    "x-tindio-organization-id",
    "cache-control",
    "retry-after",
    "x-tindio-request-id",
  ]) assert.match(proxy, new RegExp(`["']${header}["']`));
  assert.doesNotMatch(proxy, /headers\s*:\s*request\.headers|["']cookie["']/);
});

test("D11 retains Web rollback and leaves every higher-risk mutation and client origin unchanged", async () => {
  const [webRoute, checkout, refund, transfer, ticket, attendance, sync, terminal, mobile, readme] =
    await Promise.all([
      read("src/app/api/pos/v2/customer-display/route.ts"),
      read("src/app/api/pos/v2/checkout/route.ts"),
      read("src/app/api/pos/v2/receipts/[receiptId]/refund/route.ts"),
      read("src/app/api/pos/v2/transfers/[transferId]/receive/route.ts"),
      read("src/app/api/pos/v2/tickets/save/route.ts"),
      read("src/app/api/pos/v2/attendance/clock-in/route.ts"),
      read("src/app/api/pos/v2/sync/push/route.ts"),
      read("src/features/pos/pos-terminal.tsx"),
      read("apps/mobile/src/lib/tindio-api.ts"),
      read("apps/backend/README.md"),
    ]);

  assert.match(webRoute, /export async function PUT/);
  for (const mutation of [checkout, refund, transfer, ticket, attendance, sync]) {
    assert.match(mutation, /export async function POST/);
  }
  assert.match(terminal, /["']\/api\/pos\/v2\/customer-display["']/);
  assert.doesNotMatch(mobile, /TINDIO_WEB_API_ORIGIN|apps\/backend/);
  assert.match(readme, /No financial, custody, attendance, or offline-replayed mutation/);
});
