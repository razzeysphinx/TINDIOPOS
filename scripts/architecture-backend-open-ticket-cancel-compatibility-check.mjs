import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("open-ticket cancellation has a focused platform-neutral contract", async () => {
  const [manifestSource, contract] = await Promise.all([
    read("packages/contracts/package.json"),
    read("packages/contracts/src/open-ticket-cancel.ts"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(manifest.exports["./open-ticket-cancel"].types, "./src/open-ticket-cancel.ts");
  for (const value of [
    "POS_OPEN_TICKET_CANCEL_PATH",
    "POS_OPEN_TICKET_CANCEL_RPC",
    "POS_OPEN_TICKET_CANCEL_PERMISSIONS",
    "POS_OPEN_TICKET_CANCEL_FEATURE",
    "cancelOpenTicketSchema",
    "CancelOpenTicketValues",
    "OpenTicketCancelResult",
  ]) assert.match(contract, new RegExp(`\\b${value}\\b`));
  for (const value of [
    '"/api/pos/v2/tickets/cancel"',
    '"cancel_open_ticket"',
    '"tickets.manage"',
    '"open_tickets"',
    '"P0002"',
    '"Ticket cancelled."',
  ]) assert.ok(contract.includes(value), `missing shared contract value ${value}`);
  assert.doesNotMatch(contract, /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/);
});

test("Web rollback route and service consume the frozen cancellation contract", async () => {
  const [route, action, service, schema] = await Promise.all([
    read("src/app/api/pos/v2/tickets/cancel/route.ts"),
    read("src/features/advanced-sales/ticket-actions.ts"),
    read("src/features/advanced-sales/ticket-service.ts"),
    read("src/features/advanced-sales/ticket-schema.ts"),
  ]);

  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function (?:GET|PUT|PATCH|DELETE)/);
  const handler = route.slice(route.indexOf("export async function POST"));
  assert.ok(handler.indexOf("getPosV2BusinessContext") < handler.indexOf("readPosApiJson"));
  assert.match(handler, /cancelOpenTicket\(\{ context, input: body\.input \}\)/);
  assert.doesNotMatch(action, /cancelOpenTicketAction/);
  assert.doesNotMatch(action, /mergeOpenTicketsAction/);
  for (const permission of ["pos.access", "sales.create", "tickets.manage"]) {
    assert.ok(service.includes(`hasPermission(context, "${permission}")`));
  }
  assert.match(service, /context\.features\.open_tickets/);
  assert.match(service, /database\.rpc\(POS_OPEN_TICKET_CANCEL_RPC/);
  assert.match(service, /POS_OPEN_TICKET_CANCEL_INPUT_MESSAGE/);
  assert.match(service, /POS_OPEN_TICKET_CANCEL_SUCCESS_MESSAGE/);
  assert.match(schema, /@tindio\/contracts\/open-ticket-cancel/);
});

test("Backend cancellation oracle remains isolated beside the owned route", async () => {
  const [oracle, backendEnv] = await Promise.all([
    read("apps/backend/src/pos/open-ticket-cancel-compatibility.ts"),
    read("apps/backend/.env.example"),
  ]);

  assert.match(oracle, /OPEN_TICKET_CANCEL_COMPATIBILITY_CONTRACT/);
  assert.match(oracle, /validateOpenTicketCancel/);
  assert.match(oracle, /toOpenTicketCancelRpcArguments/);
  assert.match(oracle, /mapOpenTicketCancelRpcResult/);
  assert.doesNotMatch(oracle, /fetch\(|createPosReadRuntime|createNeonDataApiFetch|@supabase|@neon|process\.env/);
  assert.equal(existsSync(new URL("../apps/backend/api/pos/v2/tickets/cancel.ts", import.meta.url)), true);
  assert.match(backendEnv, /^TINDIO_OPEN_TICKET_CANCEL_MODE=owned$/m);
});

test("database authority retains ticket lock, shift custody, repeated-cancel failure, and grants", async () => {
  const [baseline, providerNeutral] = await Promise.all([
    read("database/baseline/0001_tindio_baseline.sql"),
    read("database/migrations/0003_provider_neutral_roles_rls.sql"),
  ]);
  const privateStart = baseline.indexOf('CREATE OR REPLACE FUNCTION "private"."cancel_open_ticket"');
  const privateEnd = baseline.indexOf("-- Name: cancel_purchase_order", privateStart);
  const privateBody = baseline.slice(privateStart, privateEnd);
  const publicStart = baseline.indexOf('CREATE OR REPLACE FUNCTION "public"."cancel_open_ticket"');
  const publicEnd = baseline.indexOf("-- Name: cancel_purchase_order", publicStart);
  const publicBody = baseline.slice(publicStart, publicEnd);

  assert.ok(privateStart >= 0 && privateEnd > privateStart);
  assert.ok(publicStart >= 0 && publicEnd > publicStart);
  assert.match(privateBody, /SECURITY DEFINER/);
  assert.match(privateBody, /private\.current_profile_id\(\)/);
  assert.match(privateBody, /private\.has_permission\(target_organization_id, 'sales\.create'\)/);
  assert.match(privateBody, /ticket\.organization_id = target_organization_id/);
  assert.match(privateBody, /ticket\.status = 'open'/);
  assert.match(privateBody, /for update/);
  assert.match(privateBody, /errcode = 'P0002'/);
  assert.match(privateBody, /private\.require_active_pos_shift/);
  assert.match(privateBody, /set status = 'cancelled'/);
  assert.match(publicBody, /SECURITY DEFINER/);
  assert.match(publicBody, /private\.cancel_open_ticket/);
  assert.match(providerNeutral, /GRANT ALL ON FUNCTION "public"\."cancel_open_ticket"[^;]+TO "tindio_authenticated"/s);
});

test("D19 converges Mobile and Web while adjacent mutation ownership stays unchanged", async () => {
  const [mobileApi, mobileTickets, browserApi, webPos, actions, readme, save, merge, move, split, checkout, refund, transfer, attendance, sync] = await Promise.all([
    read("apps/mobile/src/lib/tindio-api.ts"),
    read("apps/mobile/app/(app)/tickets.tsx"),
    read("src/features/pos/pos-v2-browser-api.ts"),
    read("src/features/pos/pos-terminal.tsx"),
    read("src/features/advanced-sales/ticket-actions.ts"),
    read("apps/backend/README.md"),
    read("apps/backend/api/pos/v2/tickets/save.ts"),
    read("src/app/api/pos/v2/tickets/merge/route.ts"),
    read("src/app/api/pos/v2/tickets/move-lines/route.ts"),
    read("src/app/api/pos/v2/tickets/split/route.ts"),
    read("src/app/api/pos/v2/checkout/route.ts"),
    read("src/app/api/pos/v2/receipts/[receiptId]/refund/route.ts"),
    read("src/app/api/pos/v2/transfers/[transferId]/receive/route.ts"),
    read("src/app/api/pos/v2/attendance/clock-in/route.ts"),
    read("src/app/api/pos/v2/sync/push/route.ts"),
  ]);

  assert.match(mobileApi, /request\(POS_OPEN_TICKET_CANCEL_PATH/);
  assert.match(mobileTickets, /cancelPosV2Ticket/);
  assert.match(browserApi, /export async function cancelPosV2OpenTicket/);
  assert.match(browserApi, /POS_OPEN_TICKET_CANCEL_PATH/);
  assert.match(webPos, /cancelPosV2OpenTicket\(organizationId/);
  assert.doesNotMatch(actions, /cancelOpenTicketAction/);
  for (const mutation of [save, merge, move, split, checkout, refund, transfer, attendance, sync]) {
    assert.match(mutation, /export async function POST/);
  }
  assert.doesNotMatch(mobileApi, /TINDIO_WEB_API_ORIGIN|apps\/backend/);
  assert.match(readme, /Slice D19 uses that frozen contract/);
});
