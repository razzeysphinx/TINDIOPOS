import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("open-ticket save has a focused platform-neutral contract", async () => {
  const [manifestSource, contract] = await Promise.all([
    read("packages/contracts/package.json"),
    read("packages/contracts/src/open-ticket-save.ts"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(manifest.exports["./open-ticket-save"].types, "./src/open-ticket-save.ts");
  for (const value of [
    "POS_OPEN_TICKET_SAVE_PATH",
    "POS_OPEN_TICKET_SAVE_RPC",
    "POS_OPEN_TICKET_SAVE_PERMISSIONS",
    "POS_OPEN_TICKET_SAVE_FEATURE",
    "openTicketCartLineSchema",
    "saveOpenTicketSchema",
    "SaveOpenTicketValues",
    "OpenTicketSaveResult",
  ]) assert.match(contract, new RegExp(`\\b${value}\\b`));
  for (const value of [
    '"/api/pos/v2/tickets/save"',
    '"save_open_ticket_v2"',
    '"tickets.manage"',
    '"open_tickets"',
    ".min(0.001).max(10_000)",
    ".min(1).max(100)",
  ]) assert.ok(contract.includes(value), `missing shared contract value ${value}`);
  assert.doesNotMatch(contract, /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/);
});

test("Web rollback route and service consume the frozen contract", async () => {
  const [route, action, service, schema] = await Promise.all([
    read("src/app/api/pos/v2/tickets/save/route.ts"),
    read("src/features/advanced-sales/ticket-actions.ts"),
    read("src/features/advanced-sales/ticket-service.ts"),
    read("src/features/advanced-sales/ticket-schema.ts"),
  ]);

  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function (?:GET|PUT|PATCH|DELETE)/);
  const handler = route.slice(route.indexOf("export async function POST"));
  assert.ok(handler.indexOf("getPosV2BusinessContext") < handler.indexOf("readPosApiJson"));
  assert.match(handler, /saveOpenTicket\(\{ context, input: body\.input \}\)/);
  assert.doesNotMatch(action, /saveOpenTicketAction/);
  assert.doesNotMatch(action, /mergeOpenTicketsAction/);
  for (const permission of ["pos.access", "sales.create", "tickets.manage"]) {
    assert.ok(service.includes(`hasPermission(context, "${permission}")`));
  }
  assert.match(service, /context\.features\.open_tickets/);
  assert.match(service, /context\.storeIds\.includes\(parsed\.data\.storeId\)/);
  assert.match(service, /supabase\.rpc\(POS_OPEN_TICKET_SAVE_RPC/);
  assert.match(schema, /@tindio\/contracts\/open-ticket-save/);
  assert.match(service, /@tindio\/contracts\/open-ticket-save/);
});

test("Backend open-ticket save oracle remains isolated beside the owned route", async () => {
  const [oracle, backendEnv] = await Promise.all([
    read("apps/backend/src/pos/open-ticket-save-compatibility.ts"),
    read("apps/backend/.env.example"),
  ]);

  assert.match(oracle, /OPEN_TICKET_SAVE_COMPATIBILITY_CONTRACT/);
  assert.match(oracle, /validateOpenTicketSave/);
  assert.match(oracle, /toOpenTicketSaveRpcArguments/);
  assert.match(oracle, /mapOpenTicketSaveRpcResult/);
  assert.doesNotMatch(oracle, /fetch\(|createPosReadRuntime|createNeonDataApiFetch|@supabase|@neon|process\.env/);
  assert.equal(existsSync(new URL("../apps/backend/api/pos/v2/tickets/save.ts", import.meta.url)), true);
  assert.match(backendEnv, /^TINDIO_OPEN_TICKET_SAVE_MODE=owned$/m);
});

test("database authority retains shift custody, validation, reassignment, and stable updates", async () => {
  const [baseline, providerNeutral] = await Promise.all([
    read("database/baseline/0001_tindio_baseline.sql"),
    read("database/migrations/0003_provider_neutral_roles_rls.sql"),
  ]);
  const privateStart = baseline.indexOf('CREATE OR REPLACE FUNCTION "private"."save_open_ticket_v2"');
  const privateEnd = baseline.indexOf("-- Name: seed_default_payment_methods_for_organization", privateStart);
  const privateBody = baseline.slice(privateStart, privateEnd);
  const publicStart = baseline.indexOf('CREATE OR REPLACE FUNCTION "public"."save_open_ticket_v2"');
  const publicEnd = baseline.indexOf("-- Name: save_smart_menu_configuration", publicStart);
  const publicBody = baseline.slice(publicStart, publicEnd);

  assert.ok(privateStart >= 0 && privateEnd > privateStart);
  assert.ok(publicStart >= 0 && publicEnd > publicStart);
  assert.match(privateBody, /SECURITY DEFINER/);
  assert.match(privateBody, /private\.has_permission\(target_organization_id, 'sales\.create'\)/);
  assert.match(privateBody, /private\.require_active_pos_shift/);
  assert.match(privateBody, /private\.validate_advanced_cart/);
  assert.match(privateBody, /private\.normalize_open_ticket_cart/);
  assert.match(privateBody, /'employees\.manage'/);
  assert.match(privateBody, /customer\.status = 'active'/);
  assert.match(privateBody, /option\.is_active/);
  assert.match(privateBody, /if target_ticket_id is null then/);
  assert.match(privateBody, /where ticket\.id = target_ticket_id/);
  assert.match(privateBody, /ticket\.status = 'open'/);
  assert.match(privateBody, /errcode = 'P0002'/);
  assert.match(publicBody, /SECURITY DEFINER/);
  assert.match(publicBody, /from private\.save_open_ticket_v2/);
  assert.match(providerNeutral, /GRANT ALL ON FUNCTION "public"\."save_open_ticket_v2"[^;]+TO "tindio_authenticated"/s);
});

test("open-ticket save converges Mobile and Web on the HTTP entry point", async () => {
  const [mobileApi, mobilePos, browserApi, webPos, actions, cancel, merge, move, split, checkout, refund, syncPush] = await Promise.all([
    read("apps/mobile/src/lib/tindio-api.ts"),
    read("apps/mobile/app/(app)/pos.tsx"),
    read("src/features/pos/pos-v2-browser-api.ts"),
    read("src/features/pos/pos-terminal.tsx"),
    read("src/features/advanced-sales/ticket-actions.ts"),
    read("src/app/api/pos/v2/tickets/cancel/route.ts"),
    read("src/app/api/pos/v2/tickets/merge/route.ts"),
    read("src/app/api/pos/v2/tickets/move-lines/route.ts"),
    read("src/app/api/pos/v2/tickets/split/route.ts"),
    read("src/app/api/pos/v2/checkout/route.ts"),
    read("src/app/api/pos/v2/receipts/[receiptId]/refund/route.ts"),
    read("src/app/api/pos/v2/sync/push/route.ts"),
  ]);

  assert.match(mobileApi, /request\(POS_OPEN_TICKET_SAVE_PATH/);
  assert.match(mobileApi, /@tindio\/contracts\/open-ticket-save/);
  assert.match(mobilePos, /savePosV2Ticket/);
  assert.match(browserApi, /export async function savePosV2OpenTicket/);
  assert.match(browserApi, /POS_OPEN_TICKET_SAVE_PATH/);
  assert.match(webPos, /savePosV2OpenTicket\(organizationId/);
  assert.doesNotMatch(actions, /saveOpenTicketAction/);
  for (const source of [cancel, merge, move, split, checkout, refund, syncPush]) {
    assert.match(source, /export async function POST/);
  }
});
