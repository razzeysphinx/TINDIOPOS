import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("open-ticket split has a focused platform-neutral contract", async () => {
  const [manifestSource, contract] = await Promise.all([
    read("packages/contracts/package.json"),
    read("packages/contracts/src/open-ticket-split.ts"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(manifest.exports["./open-ticket-split"].types, "./src/open-ticket-split.ts");
  for (const value of [
    "POS_OPEN_TICKET_SPLIT_PATH",
    "POS_OPEN_TICKET_SPLIT_RPC",
    "POS_OPEN_TICKET_SPLIT_PERMISSIONS",
    "POS_OPEN_TICKET_SPLIT_FEATURE",
    "splitOpenTicketSchema",
    "SplitOpenTicketValues",
    "OpenTicketSplitResult",
  ]) assert.match(contract, new RegExp(`\\b${value}\\b`));
  for (const value of [
    '"/api/pos/v2/tickets/split"',
    '"split_open_ticket"',
    '"tickets.manage"',
    '"open_tickets"',
    '"P0002"',
    '"A new ticket was created from the selected items."',
  ]) assert.ok(contract.includes(value), `missing shared contract value ${value}`);
  assert.doesNotMatch(
    contract,
    /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/,
  );
});

test("Web route and service established the frozen split contract", async () => {
  const [route, service, schema] = await Promise.all([
    read("src/app/api/pos/v2/tickets/split/route.ts"),
    read("src/features/advanced-sales/ticket-service.ts"),
    read("src/features/advanced-sales/ticket-schema.ts"),
  ]);

  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function (?:GET|PUT|PATCH|DELETE)/);
  const handler = route.slice(route.indexOf("export async function POST"));
  assert.ok(handler.indexOf("getPosV2BusinessContext") < handler.indexOf("readPosApiJson"));
  assert.match(handler, /splitOpenTicket\(\{ context, input: body\.input \}\)/);
  for (const permission of ["pos.access", "sales.create", "tickets.manage"]) {
    assert.ok(service.includes(`hasPermission(context, "${permission}")`));
  }
  assert.match(service, /context\.features\.open_tickets/);
  assert.match(service, /\.rpc\(POS_OPEN_TICKET_SPLIT_RPC/);
  assert.match(service, /POS_OPEN_TICKET_SPLIT_INPUT_MESSAGE/);
  assert.match(service, /POS_OPEN_TICKET_SPLIT_SUCCESS_MESSAGE/);
  assert.match(schema, /@tindio\/contracts\/open-ticket-split/);
  assert.match(service, /@tindio\/contracts\/open-ticket-split/);
});

test("Backend split oracle remains isolated beside the owned route", async () => {
  const oracle = await read("apps/backend/src/pos/open-ticket-split-compatibility.ts");

  assert.match(oracle, /OPEN_TICKET_SPLIT_COMPATIBILITY_CONTRACT/);
  assert.match(oracle, /validateOpenTicketSplit/);
  assert.match(oracle, /toOpenTicketSplitRpcArguments/);
  assert.match(oracle, /mapOpenTicketSplitRpcResult/);
  assert.doesNotMatch(
    oracle,
    /fetch\(|createPosReadRuntime|createNeonDataApiFetch|@supabase|@neon|process\.env/,
  );
  assert.equal(
    existsSync(new URL("../apps/backend/api/pos/v2/tickets/split.ts", import.meta.url)),
    true,
  );
});

test("database authority retains atomic source, shift, inheritance, line, source, and audit rules", async () => {
  const [baseline, providerNeutral] = await Promise.all([
    read("database/baseline/0001_tindio_baseline.sql"),
    read("database/migrations/0003_provider_neutral_roles_rls.sql"),
  ]);
  const privateStart = baseline.indexOf(
    'CREATE OR REPLACE FUNCTION "private"."reallocate_open_ticket_lines"',
  );
  const privateEnd = baseline.indexOf("-- Name: receive_inventory_transfer", privateStart);
  const privateBody = baseline.slice(privateStart, privateEnd);
  const publicStart = baseline.indexOf(
    'CREATE OR REPLACE FUNCTION "public"."split_open_ticket"',
  );
  const publicEnd = baseline.indexOf("-- Name: start_stock_request_picking", publicStart);
  const publicBody = baseline.slice(publicStart, publicEnd);

  assert.ok(privateStart >= 0 && privateEnd > privateStart);
  assert.ok(publicStart >= 0 && publicEnd > publicStart);
  assert.match(privateBody, /SECURITY DEFINER/);
  assert.match(privateBody, /jsonb_array_length\(target_lines\) not between 1 and 100/);
  assert.match(privateBody, /count\(distinct requested\.value ->> 'ticket_line_id'\)/);
  assert.match(privateBody, /selected_quantity > source_quantity/);
  assert.match(privateBody, /gen_random_uuid\(\)::text/);
  assert.match(privateBody, /jsonb_array_length\(destination_next_cart\) > 100/);
  assert.match(privateBody, /jsonb_array_length\(source_next_cart\) > 0[\s\S]+update public\.open_tickets/s);
  assert.match(publicBody, /SECURITY DEFINER/);
  assert.match(publicBody, /char_length\(normalized_label\) > 100/);
  assert.match(publicBody, /ticket\.status = 'open'/);
  assert.match(publicBody, /for update/);
  assert.match(publicBody, /private\.require_active_pos_shift/);
  for (const inherited of [
    "assigned_employee_id", "customer_id", "dining_option_id", "note",
  ]) assert.match(publicBody, new RegExp(`source_ticket\\.${inherited}`));
  assert.match(publicBody, /private\.reallocate_open_ticket_lines/);
  assert.match(publicBody, /false,\s+true/s);
  assert.match(publicBody, /'OPEN_TICKET_SPLIT'/);
  assert.match(publicBody, /'ticket\.split'/);
  assert.match(
    providerNeutral,
    /GRANT ALL ON FUNCTION "public"\."split_open_ticket"[^;]+TO "tindio_authenticated"/s,
  );
});

test("D22 contract now converges Web and Mobile while adjacent mutations stay Web-owned", async () => {
  const [mobileApi, mobileTickets, browserApi, dialogs, actions, environment, readme, merge, checkout, refund, transfer, attendance, sync] =
    await Promise.all([
      read("apps/mobile/src/lib/tindio-api.ts"),
      read("apps/mobile/app/(app)/tickets.tsx"),
      read("src/features/pos/pos-v2-browser-api.ts"),
      read("src/features/advanced-sales/ticket-workspace-dialogs.tsx"),
      read("src/features/advanced-sales/ticket-actions.ts"),
      read("apps/backend/.env.example"),
      read("apps/backend/README.md"),
      read("src/app/api/pos/v2/tickets/merge/route.ts"),
      read("src/app/api/pos/v2/checkout/route.ts"),
      read("src/app/api/pos/v2/receipts/[receiptId]/refund/route.ts"),
      read("src/app/api/pos/v2/transfers/[transferId]/receive/route.ts"),
      read("src/app/api/pos/v2/attendance/clock-in/route.ts"),
      read("src/app/api/pos/v2/sync/push/route.ts"),
    ]);

  assert.match(mobileApi, /request\(POS_OPEN_TICKET_SPLIT_PATH/);
  assert.match(mobileApi, /@tindio\/contracts\/open-ticket-split/);
  assert.match(mobileTickets, /splitPosV2Ticket/);
  assert.match(browserApi, /splitPosV2OpenTicket/);
  assert.match(browserApi, /POS_OPEN_TICKET_SPLIT_PATH/);
  assert.match(dialogs, /splitPosV2OpenTicket\(organizationId/);
  assert.doesNotMatch(dialogs, /splitOpenTicketAction/);
  assert.doesNotMatch(actions, /splitOpenTicketAction/);
  assert.match(environment, /^TINDIO_OPEN_TICKET_SPLIT_MODE=owned$/m);
  for (const mutation of [merge, checkout, refund, transfer, attendance, sync]) {
    assert.match(mutation, /export async function POST/);
  }
  assert.doesNotMatch(mobileApi, /TINDIO_WEB_API_ORIGIN|apps\/backend/);
  assert.match(readme, /Slice D23 Backend-owned open-ticket split/);
});
