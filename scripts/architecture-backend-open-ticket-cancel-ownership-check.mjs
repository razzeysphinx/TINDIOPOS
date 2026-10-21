import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Backend owns only the open-ticket cancellation POST mutation", async () => {
  const [route, service, environment] = await Promise.all([
    read("apps/backend/api/pos/v2/tickets/cancel.ts"),
    read("apps/backend/src/pos/open-ticket-cancel-service.ts"),
    read("apps/backend/.env.example"),
  ]);
  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function (?:GET|PUT|PATCH|DELETE)/);
  assert.match(route, /TINDIO_OPEN_TICKET_CANCEL_MODE/);
  assert.match(service, /options\.mode \?\? ["']owned["']/);
  assert.match(service, /mode === ["']proxy["']/);
  assert.match(environment, /^TINDIO_OPEN_TICKET_CANCEL_MODE=owned$/m);
});

test("owned cancellation preserves context, validation order, custody, and envelopes", async () => {
  const owned = await read("apps/backend/src/pos/open-ticket-cancel-owned.ts");
  for (const value of [
    "verifyClaims", "loadCore", "IDENTITY_UNMAPPED", "ORGANIZATION_INACTIVE",
    "INVALID_BUSINESS_TYPE", "POS_OPEN_TICKET_CANCEL_REQUEST_INVALID_MESSAGE",
    "validateOpenTicketCancel", "openTicketsEnabled", "cancelTicket",
    "mapOpenTicketCancelRpcResult", '"cache-control": "private, no-store"',
  ]) assert.ok(owned.includes(value), `missing owned behavior ${value}`);
  assert.ok(owned.indexOf("loadCore") < owned.indexOf("request.json()"));
  assert.ok(owned.indexOf("request.json()") < owned.indexOf("validateOpenTicketCancel(input"));
  assert.ok(owned.indexOf("validateOpenTicketCancel(input") < owned.indexOf("dependencies.cancelTicket("));
  assert.match(owned, /POS_OPEN_TICKET_CANCEL_REQUEST_INVALID_MESSAGE[\s\S]+400/);
  assert.doesNotMatch(owned, /service[_-]?role|DATABASE_URL/i);
});

test("cancellation runtime verifies Supabase claims and mutates only through Neon", async () => {
  const [runtime, adapter] = await Promise.all([
    read("apps/backend/src/pos/open-ticket-cancel-runtime.ts"),
    read("apps/backend/src/database/neon-data-api-fetch.ts"),
  ]);
  assert.match(runtime, /authClient\.auth\.getClaims\(token\)/);
  assert.match(runtime, /createNeonDataApiFetch/);
  assert.match(runtime, /get_pos_bootstrap_core_v2/);
  assert.match(runtime, /\.rpc\(POS_OPEN_TICKET_CANCEL_RPC/);
  for (const header of [
    "x-tindio-device-id", "x-tindio-device-secret", "x-tindio-app-version",
  ]) assert.match(runtime, new RegExp(`["']${header}["']`));
  assert.match(adapter, /rewritten\.headers\.delete\(["']apikey["']\)/);
  assert.doesNotMatch(runtime, /service[_-]?role|DATABASE_URL/i);
});

test("cancellation rollback preserves body and rejects ambient credentials", async () => {
  const proxy = await read("apps/backend/src/pos/open-ticket-cancel-proxy.ts");
  assert.match(proxy, /POS_OPEN_TICKET_CANCEL_PATH/);
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

test("D19 converges Web and Mobile while adjacent high-risk mutations stay in Web", async () => {
  const [webRoute, browserApi, webPos, actions, mobileApi, mobileTickets, save, merge, move, split, checkout, refund, transfer, attendance, sync, readme] =
    await Promise.all([
      read("src/app/api/pos/v2/tickets/cancel/route.ts"),
      read("src/features/pos/pos-v2-browser-api.ts"),
      read("src/features/pos/pos-terminal.tsx"),
      read("src/features/advanced-sales/ticket-actions.ts"),
      read("apps/mobile/src/lib/tindio-api.ts"),
      read("apps/mobile/app/(app)/tickets.tsx"),
      read("apps/backend/api/pos/v2/tickets/save.ts"),
      read("src/app/api/pos/v2/tickets/merge/route.ts"),
      read("src/app/api/pos/v2/tickets/move-lines/route.ts"),
      read("src/app/api/pos/v2/tickets/split/route.ts"),
      read("src/app/api/pos/v2/checkout/route.ts"),
      read("src/app/api/pos/v2/receipts/[receiptId]/refund/route.ts"),
      read("src/app/api/pos/v2/transfers/[transferId]/receive/route.ts"),
      read("src/app/api/pos/v2/attendance/clock-in/route.ts"),
      read("src/app/api/pos/v2/sync/push/route.ts"),
      read("apps/backend/README.md"),
    ]);
  assert.match(webRoute, /export async function POST/);
  assert.match(browserApi, /export async function cancelPosV2OpenTicket/);
  assert.match(browserApi, /POS_OPEN_TICKET_CANCEL_PATH/);
  assert.match(webPos, /cancelPosV2OpenTicket\(organizationId/);
  assert.doesNotMatch(webPos, /cancelOpenTicketAction/);
  assert.doesNotMatch(actions, /cancelOpenTicketAction/);
  assert.match(mobileApi, /request\(POS_OPEN_TICKET_CANCEL_PATH/);
  assert.match(mobileTickets, /cancelPosV2Ticket/);
  for (const mutation of [save, merge, move, split, checkout, refund, transfer, attendance, sync]) {
    assert.match(mutation, /export async function POST/);
  }
  assert.doesNotMatch(mobileApi, /TINDIO_WEB_API_ORIGIN|apps\/backend/);
  assert.match(
    readme,
    /No financial, custody, attendance, or offline-replayed mutation outside the\s+explicitly listed Backend-owned commands/,
  );
});
