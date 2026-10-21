import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("open-ticket line movement has a focused platform-neutral contract", async () => {
  const [manifestSource, contract] = await Promise.all([
    read("packages/contracts/package.json"),
    read("packages/contracts/src/open-ticket-move-lines.ts"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(
    manifest.exports["./open-ticket-move-lines"].types,
    "./src/open-ticket-move-lines.ts",
  );
  for (const value of [
    "POS_OPEN_TICKET_MOVE_LINES_PATH",
    "POS_OPEN_TICKET_MOVE_LINES_RPC",
    "POS_OPEN_TICKET_MOVE_LINES_PERMISSIONS",
    "POS_OPEN_TICKET_MOVE_LINES_FEATURE",
    "ticketReallocationLinesSchema",
    "moveOpenTicketLinesSchema",
    "MoveOpenTicketLinesValues",
    "OpenTicketMoveLinesResult",
  ]) assert.match(contract, new RegExp(`\\b${value}\\b`));
  for (const value of [
    '"/api/pos/v2/tickets/move-lines"',
    '"move_open_ticket_lines"',
    '"tickets.manage"',
    '"open_tickets"',
    '"P0002"',
    '"Selected items moved to the destination ticket."',
  ]) assert.ok(contract.includes(value), `missing shared contract value ${value}`);
  assert.doesNotMatch(
    contract,
    /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/,
  );
});

test("Web route and service established the frozen line-movement contract", async () => {
  const [route, service, schema] = await Promise.all([
    read("src/app/api/pos/v2/tickets/move-lines/route.ts"),
    read("src/features/advanced-sales/ticket-service.ts"),
    read("src/features/advanced-sales/ticket-schema.ts"),
  ]);

  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function (?:GET|PUT|PATCH|DELETE)/);
  const handler = route.slice(route.indexOf("export async function POST"));
  assert.ok(handler.indexOf("getPosV2BusinessContext") < handler.indexOf("readPosApiJson"));
  assert.match(handler, /moveOpenTicketLines\(\{ context, input: body\.input \}\)/);
  for (const permission of ["pos.access", "sales.create", "tickets.manage"]) {
    assert.ok(service.includes(`hasPermission(context, "${permission}")`));
  }
  assert.match(service, /context\.features\.open_tickets/);
  assert.match(service, /\.rpc\(POS_OPEN_TICKET_MOVE_LINES_RPC/);
  assert.match(service, /POS_OPEN_TICKET_MOVE_LINES_INPUT_MESSAGE/);
  assert.match(service, /POS_OPEN_TICKET_MOVE_LINES_SUCCESS_MESSAGE/);
  assert.match(schema, /@tindio\/contracts\/open-ticket-move-lines/);
  assert.match(service, /@tindio\/contracts\/open-ticket-move-lines/);
});

test("Backend line-movement oracle remains isolated beside the owned route", async () => {
  const oracle = await read(
    "apps/backend/src/pos/open-ticket-move-lines-compatibility.ts",
  );

  assert.match(oracle, /OPEN_TICKET_MOVE_LINES_COMPATIBILITY_CONTRACT/);
  assert.match(oracle, /validateOpenTicketMoveLines/);
  assert.match(oracle, /toOpenTicketMoveLinesRpcArguments/);
  assert.match(oracle, /mapOpenTicketMoveLinesRpcResult/);
  assert.doesNotMatch(
    oracle,
    /fetch\(|createPosReadRuntime|createNeonDataApiFetch|@supabase|@neon|process\.env/,
  );
  assert.equal(
    existsSync(new URL("../apps/backend/api/pos/v2/tickets/move-lines.ts", import.meta.url)),
    true,
  );
});

test("database authority retains atomic pair, quantity, shift, partial-line, and audit rules", async () => {
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
    'CREATE OR REPLACE FUNCTION "public"."move_open_ticket_lines"',
  );
  const publicEnd = baseline.indexOf("-- Name: open_register_shift", publicStart);
  const publicBody = baseline.slice(publicStart, publicEnd);

  assert.ok(privateStart >= 0 && privateEnd > privateStart);
  assert.ok(publicStart >= 0 && publicEnd > publicStart);
  assert.match(privateBody, /SECURITY DEFINER/);
  assert.match(privateBody, /target_source_ticket_id = target_destination_ticket_id/);
  assert.match(privateBody, /jsonb_array_length\(target_lines\) not between 1 and 100/);
  assert.match(privateBody, /count\(distinct requested\.value ->> 'ticket_line_id'\)/);
  assert.match(privateBody, /order by ticket\.id\s+for update/s);
  assert.match(privateBody, /source_ticket\.status <> 'open'/);
  assert.match(privateBody, /source_ticket\.store_id <> destination_ticket\.store_id/);
  assert.match(privateBody, /source_ticket\.register_id <> destination_ticket\.register_id/);
  assert.match(privateBody, /private\.require_active_pos_shift/);
  assert.match(privateBody, /selected_quantity > source_quantity/);
  assert.match(privateBody, /gen_random_uuid\(\)::text/);
  assert.match(privateBody, /jsonb_array_length\(destination_next_cart\) > 100/);
  assert.match(privateBody, /Keep at least one item on the source ticket, or merge it instead\./);
  assert.match(publicBody, /SECURITY DEFINER/);
  assert.match(publicBody, /private\.require_active_pos_shift/);
  assert.match(publicBody, /private\.reallocate_open_ticket_lines/);
  assert.match(publicBody, /false,\s+false/s);
  assert.match(publicBody, /'OPEN_TICKET_LINES_MOVED'/);
  assert.match(publicBody, /'ticket\.move'/);
  assert.match(
    providerNeutral,
    /GRANT ALL ON FUNCTION "public"\."move_open_ticket_lines"[^;]+TO "tindio_authenticated"/s,
  );
});

test("D20 contract now converges Web and Mobile while adjacent mutations stay Web-owned", async () => {
  const [mobileApi, mobileTickets, browserApi, dialogs, actions, environment, readme, merge, split, checkout, refund, transfer, attendance, sync] =
    await Promise.all([
      read("apps/mobile/src/lib/tindio-api.ts"),
      read("apps/mobile/app/(app)/tickets.tsx"),
      read("src/features/pos/pos-v2-browser-api.ts"),
      read("src/features/advanced-sales/ticket-workspace-dialogs.tsx"),
      read("src/features/advanced-sales/ticket-actions.ts"),
      read("apps/backend/.env.example"),
      read("apps/backend/README.md"),
      read("src/app/api/pos/v2/tickets/merge/route.ts"),
      read("src/app/api/pos/v2/tickets/split/route.ts"),
      read("src/app/api/pos/v2/checkout/route.ts"),
      read("src/app/api/pos/v2/receipts/[receiptId]/refund/route.ts"),
      read("src/app/api/pos/v2/transfers/[transferId]/receive/route.ts"),
      read("src/app/api/pos/v2/attendance/clock-in/route.ts"),
      read("src/app/api/pos/v2/sync/push/route.ts"),
    ]);

  assert.match(mobileApi, /request\(POS_OPEN_TICKET_MOVE_LINES_PATH/);
  assert.match(mobileApi, /@tindio\/contracts\/open-ticket-move-lines/);
  assert.match(mobileTickets, /movePosV2TicketLines/);
  assert.match(browserApi, /movePosV2OpenTicketLines/);
  assert.match(browserApi, /POS_OPEN_TICKET_MOVE_LINES_PATH/);
  assert.match(dialogs, /movePosV2OpenTicketLines\(organizationId/);
  assert.doesNotMatch(dialogs, /moveOpenTicketLinesAction/);
  assert.doesNotMatch(actions, /moveOpenTicketLinesAction/);
  assert.match(environment, /^TINDIO_OPEN_TICKET_MOVE_LINES_MODE=owned$/m);
  for (const mutation of [merge, split, checkout, refund, transfer, attendance, sync]) {
    assert.match(mutation, /export async function POST/);
  }
  assert.doesNotMatch(mobileApi, /TINDIO_WEB_API_ORIGIN|apps\/backend/);
  assert.match(readme, /Slice D21 Backend-owned open-ticket line movement/);
});
