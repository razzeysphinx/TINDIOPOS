import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Backend owns the bounded POS live-state read", async () => {
  const [route, service, owned, runtime, sharedRuntime, environment] = await Promise.all([
    read("apps/backend/api/pos/v2/live.ts"),
    read("apps/backend/src/pos/live-service.ts"),
    read("apps/backend/src/pos/live-owned.ts"),
    read("apps/backend/src/pos/live-runtime.ts"),
    read("apps/backend/src/pos/pos-read-runtime.ts"),
    read("apps/backend/.env.example"),
  ]);

  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /POST|PUT|PATCH|DELETE/);
  assert.match(route, /TINDIO_LIVE_READ_MODE/);
  assert.match(service, /options\.mode \?\? ["']owned["']/);
  assert.match(owned, /handleOwnedPosLive/);
  assert.match(runtime, /get_pos_live_state_v2/);
  assert.match(sharedRuntime, /auth\.getClaims\(token\)/);
  assert.match(sharedRuntime, /createNeonDataApiFetch/);
  assert.match(environment, /^TINDIO_LIVE_READ_MODE=owned$/m);
});

test("owned live preserves scope, identity retry, aggregate mapping, and envelope", async () => {
  const [owned, mappers] = await Promise.all([
    read("apps/backend/src/pos/live-owned.ts"),
    read("apps/backend/src/pos/live-mappers.ts"),
  ]);

  for (const value of [
    "POS_V2_ORGANIZATION_HEADER",
    "x-tindio-store-id",
    "x-tindio-register-id",
    "STORE_REQUIRED_FOR_REGISTER",
    "IDENTITY_UNMAPPED",
    "INVALID_LIVE_RESPONSE",
    "customerDisplaySessions",
    "canReceiveIncomingTransfers",
    "incomingTransfersRaw",
    "openTicketsRaw",
    "ticketAssignees",
    "requestId",
    "no-store",
    "x-tindio-request-id",
  ]) {
    assert.match(owned, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const value of [
    "received_quantity",
    "short_quantity",
    "stock_request_id",
    "modifier_option_ids",
    "ticket_line_id",
    "Saved item",
    "fullName",
  ]) assert.match(mappers, new RegExp(value));

  assert.doesNotMatch(owned, /service[_-]?role|DATABASE_URL/i);
});

test("live rollback is loop-safe, query-preserving, and allowlisted", async () => {
  const [service, proxy] = await Promise.all([
    read("apps/backend/src/pos/live-service.ts"),
    read("apps/backend/src/pos/live-proxy.ts"),
  ]);

  assert.match(service, /mode === ["']proxy["']/);
  assert.match(proxy, /POS_LIVE_PATH\s*=\s*["']\/api\/pos\/v2\/live["']/);
  assert.match(proxy, /url\.search = requestUrl\.search/);
  assert.match(proxy, /upstream\.origin === requestUrl\.origin/);
  assert.match(proxy, /redirect:\s*["']manual["']/);
  assert.match(proxy, /cache:\s*["']no-store["']/);

  for (const header of [
    "accept",
    "authorization",
    "x-tindio-organization-id",
    "x-tindio-store-id",
    "x-tindio-register-id",
    "cache-control",
    "content-type",
    "retry-after",
    "x-tindio-request-id",
  ]) assert.match(proxy, new RegExp(`["']${header}["']`));

  assert.doesNotMatch(proxy, /headers\s*:\s*request\.headers|["']cookie["']/);
});

test("live state uses the focused cross-runtime contract", async () => {
  const [manifestSource, owned, mappers] = await Promise.all([
    read("packages/contracts/package.json"),
    read("apps/backend/src/pos/live-owned.ts"),
    read("apps/backend/src/pos/live-mappers.ts"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(manifest.exports["./pos-runtime"].types, "./src/pos-runtime.ts");
  assert.match(owned, /from ["']@tindio\/contracts\/pos-runtime["']/);
  assert.match(mappers, /from ["']@tindio\/contracts\/pos-runtime["']/);
  assert.doesNotMatch(`${owned}\n${mappers}`, /from ["']@tindio\/contracts["']/);
});

test("Web rollback remains authoritative and all live-adjacent mutations stay in Next.js", async () => {
  const [liveRoute, checkout, customerDisplay, ticketSave, clockIn, syncPush, mobileApi, readme] =
    await Promise.all([
      read("src/app/api/pos/v2/live/route.ts"),
      read("src/app/api/pos/v2/checkout/route.ts"),
      read("src/app/api/pos/v2/customer-display/route.ts"),
      read("src/app/api/pos/v2/tickets/save/route.ts"),
      read("src/app/api/pos/v2/attendance/clock-in/route.ts"),
      read("src/app/api/pos/v2/sync/push/route.ts"),
      read("apps/mobile/src/lib/tindio-api.ts"),
      read("apps/backend/README.md"),
    ]);

  assert.match(liveRoute, /getPosV2Live/);
  assert.match(checkout, /export async function POST/);
  assert.match(customerDisplay, /export async function PUT/);
  assert.match(ticketSave, /export async function POST/);
  assert.match(clockIn, /export async function POST/);
  assert.match(syncPush, /export async function POST/);
  assert.doesNotMatch(mobileApi, /TINDIO_WEB_API_ORIGIN|apps\/backend/);
  assert.match(readme, /No mutation route/);
});
