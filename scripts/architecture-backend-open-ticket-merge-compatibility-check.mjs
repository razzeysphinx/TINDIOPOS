import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("open-ticket merge has a focused platform-neutral contract", async () => {
  const [manifestSource, contract] = await Promise.all([
    read("packages/contracts/package.json"),
    read("packages/contracts/src/open-ticket-merge.ts"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(manifest.exports["./open-ticket-merge"].types, "./src/open-ticket-merge.ts");
  for (const value of [
    "POS_OPEN_TICKET_MERGE_PATH",
    "POS_OPEN_TICKET_MERGE_RPC",
    "POS_OPEN_TICKET_MERGE_PERMISSIONS",
    "POS_OPEN_TICKET_MERGE_FEATURE",
    "mergeOpenTicketsSchema",
    "MergeOpenTicketsValues",
    "OpenTicketMergeResult",
  ]) assert.match(contract, new RegExp(`\\b${value}\\b`));
  for (const value of [
    '"/api/pos/v2/tickets/merge"',
    '"merge_open_tickets"',
    '"tickets.manage"',
    '"open_tickets"',
    '"P0002"',
    '"Tickets merged. The original source ticket remains in the audit history."',
  ]) assert.ok(contract.includes(value), `missing shared contract value ${value}`);
  assert.doesNotMatch(
    contract,
    /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/,
  );
});

test("Web rollback route and service consume the frozen merge contract", async () => {
  const [route, action, service, schema] = await Promise.all([
    read("src/app/api/pos/v2/tickets/merge/route.ts"),
    read("src/features/advanced-sales/ticket-actions.ts"),
    read("src/features/advanced-sales/ticket-service.ts"),
    read("src/features/advanced-sales/ticket-schema.ts"),
  ]);

  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function (?:GET|PUT|PATCH|DELETE)/);
  const handler = route.slice(route.indexOf("export async function POST"));
  assert.ok(handler.indexOf("getPosV2BusinessContext") < handler.indexOf("readPosApiJson"));
  assert.match(handler, /mergeOpenTickets\(\{ context, input: body\.input \}\)/);
  assert.doesNotMatch(action, /mergeOpenTicketsAction/);
  for (const permission of ["pos.access", "sales.create", "tickets.manage"]) {
    assert.ok(service.includes(`hasPermission(context, "${permission}")`));
  }
  assert.match(service, /context\.features\.open_tickets/);
  assert.match(service, /posDeviceRequestHeaders\(parsed\.data\.device\)/);
  assert.match(service, /\.rpc\(POS_OPEN_TICKET_MERGE_RPC/);
  assert.match(service, /POS_OPEN_TICKET_MERGE_INPUT_MESSAGE/);
  assert.match(service, /POS_OPEN_TICKET_MERGE_SUCCESS_MESSAGE/);
  assert.match(schema, /@tindio\/contracts\/open-ticket-merge/);
});

test("Backend merge oracle remains isolated beside the owned route", async () => {
  const oracle = await read("apps/backend/src/pos/open-ticket-merge-compatibility.ts");

  assert.match(oracle, /OPEN_TICKET_MERGE_COMPATIBILITY_CONTRACT/);
  assert.match(oracle, /validateOpenTicketMerge/);
  assert.match(oracle, /toOpenTicketMergeRpcArguments/);
  assert.match(oracle, /mapOpenTicketMergeRpcResult/);
  assert.doesNotMatch(
    oracle,
    /fetch\(|createPosReadRuntime|createNeonDataApiFetch|@supabase|@neon|process\.env/,
  );
  assert.equal(
    existsSync(new URL("../apps/backend/api/pos/v2/tickets/merge.ts", import.meta.url)),
    true,
  );
});

test("database authority retains atomic dual-ticket custody, source history, and audit rules", async () => {
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
    'CREATE OR REPLACE FUNCTION "public"."merge_open_tickets"',
  );
  const publicEnd = baseline.indexOf("-- Name: move_open_ticket_lines", publicStart);
  const publicBody = baseline.slice(publicStart, publicEnd);

  assert.ok(privateStart >= 0 && privateEnd > privateStart);
  assert.ok(publicStart >= 0 && publicEnd > publicStart);
  assert.match(privateBody, /SECURITY DEFINER/);
  assert.match(privateBody, /ticket\.id in \(target_source_ticket_id, target_destination_ticket_id\)/);
  assert.match(privateBody, /source_ticket\.status <> 'open'/);
  assert.match(privateBody, /destination_ticket\.status <> 'open'/);
  assert.match(privateBody, /source_ticket\.store_id <> destination_ticket\.store_id/);
  assert.match(privateBody, /source_ticket\.register_id <> destination_ticket\.register_id/);
  assert.match(privateBody, /private\.require_active_pos_shift/);
  assert.match(privateBody, /jsonb_array_length\(destination_next_cart\) > 100/);
  assert.match(privateBody, /jsonb_array_length\(source_next_cart\) > 0[\s\S]+update public\.open_tickets/s);
  assert.match(publicBody, /SECURITY DEFINER/);
  assert.match(publicBody, /target_source_ticket_id = target_destination_ticket_id/);
  assert.match(publicBody, /ticket\.status = 'open'/);
  assert.match(publicBody, /for update/);
  assert.match(publicBody, /private\.require_active_pos_shift/);
  assert.match(publicBody, /jsonb_agg\(/);
  assert.match(publicBody, /private\.reallocate_open_ticket_lines/);
  assert.match(publicBody, /source_lines,\s+true,\s+false/s);
  assert.match(publicBody, /set status = 'merged', merged_into_ticket_id = target_destination_ticket_id/);
  assert.match(publicBody, /'OPEN_TICKETS_MERGED'/);
  assert.match(publicBody, /'ticket\.merge'/);
  assert.match(
    providerNeutral,
    /GRANT ALL ON FUNCTION "public"\."merge_open_tickets"[^;]+TO "tindio_authenticated"/s,
  );
});

test("D24 contract now converges Web and Mobile while adjacent mutations stay Web-owned", async () => {
  const [mobileApi, mobileTickets, browserApi, dialogs, actions, environment, readme, checkout, refund, transfer, attendance, sync] =
    await Promise.all([
      read("apps/mobile/src/lib/tindio-api.ts"),
      read("apps/mobile/app/(app)/tickets.tsx"),
      read("src/features/pos/pos-v2-browser-api.ts"),
      read("src/features/advanced-sales/ticket-workspace-dialogs.tsx"),
      read("src/features/advanced-sales/ticket-actions.ts"),
      read("apps/backend/.env.example"),
      read("apps/backend/README.md"),
      read("src/app/api/pos/v2/checkout/route.ts"),
      read("src/app/api/pos/v2/receipts/[receiptId]/refund/route.ts"),
      read("src/app/api/pos/v2/transfers/[transferId]/receive/route.ts"),
      read("src/app/api/pos/v2/attendance/clock-in/route.ts"),
      read("src/app/api/pos/v2/sync/push/route.ts"),
    ]);

  assert.match(mobileApi, /request\(POS_OPEN_TICKET_MERGE_PATH/);
  assert.match(mobileApi, /@tindio\/contracts\/open-ticket-merge/);
  assert.match(mobileTickets, /mergePosV2Ticket/);
  assert.match(browserApi, /mergePosV2OpenTickets/);
  assert.match(browserApi, /POS_OPEN_TICKET_MERGE_PATH/);
  assert.match(dialogs, /mergePosV2OpenTickets\(organizationId/);
  assert.doesNotMatch(dialogs, /mergeOpenTicketsAction/);
  assert.doesNotMatch(actions, /mergeOpenTicketsAction/);
  assert.match(environment, /^TINDIO_OPEN_TICKET_MERGE_MODE=owned$/m);
  for (const mutation of [checkout, refund, transfer, attendance, sync]) {
    assert.match(mutation, /export async function POST/);
  }
  assert.doesNotMatch(mobileApi, /TINDIO_WEB_API_ORIGIN|apps\/backend/);
  assert.match(readme, /Slice D25 Backend-owned open-ticket merge/);
});
