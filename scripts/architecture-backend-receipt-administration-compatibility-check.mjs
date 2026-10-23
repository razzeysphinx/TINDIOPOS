import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function functionBody(source, schema, name) {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION "${schema}"."${name}"`);
  const end = source.indexOf("\n--\n-- Name:", start + 1);
  assert.ok(start >= 0 && end > start, `missing database function ${schema}.${name}`);
  return source.slice(start, end);
}

test("receipt administration has focused platform-neutral shared contracts", async () => {
  const [manifestSource, index, settings, delivery] = await Promise.all([
    read("packages/contracts/package.json"),
    read("packages/contracts/src/index.ts"),
    read("packages/contracts/src/receipt-settings.ts"),
    read("packages/contracts/src/receipt-delivery.ts"),
  ]);
  const manifest = JSON.parse(manifestSource);
  assert.equal(manifest.exports["./receipt-settings"].types, "./src/receipt-settings.ts");
  assert.equal(manifest.exports["./receipt-delivery"].types, "./src/receipt-delivery.ts");
  assert.match(index, /export \* from "\.\/receipt-settings"/);
  assert.match(index, /export \* from "\.\/receipt-delivery"/);
  for (const [source, values] of [
    [settings, ["POS_RECEIPT_SETTINGS_RPC", "receiptSettingsSchema", "ReceiptSettingsValues", "ReceiptSettingsResult"]],
    [delivery, ["POS_RECEIPT_DELIVERY_RPC", "receiptDeliverySchema", "ReceiptDeliveryDatabaseRow", "receiptDeliverySuccessMessage"]],
  ]) {
    for (const value of values) assert.match(source, new RegExp(`\\b${value}\\b`));
    assert.doesNotMatch(source, /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/);
  }
});

test("Web actions retain context-first services, shared RPCs, and exact revalidation", async () => {
  const [action, schema, service] = await Promise.all([
    read("src/features/receipts/improvement-6-actions.ts"),
    read("src/features/receipts/improvement-6-schema.ts"),
    read("src/features/receipts/service.ts"),
  ]);
  const settingsStart = action.indexOf("export async function updateReceiptSettingsAction");
  const deliveryStart = action.indexOf("export async function queueReceiptDeliveryAction");
  const settingsBody = action.slice(settingsStart, deliveryStart);
  const deliveryBody = action.slice(deliveryStart, action.indexOf("export async function linkSaleExchangeAction"));
  assert.ok(settingsStart >= 0 && deliveryStart > settingsStart);
  assert.ok(settingsBody.indexOf("requireBusinessContext()") < settingsBody.indexOf("updateReceiptSettings({ context, input })"));
  assert.match(settingsBody, /revalidatePath\("\/back-office\/receipt-settings"\)/);
  assert.ok(deliveryBody.indexOf("requireBusinessContext()") < deliveryBody.indexOf("queueReceiptDelivery({ context, input })"));
  assert.match(deliveryBody, /revalidatePath\("\/back-office\/receipts"\)/);
  assert.match(deliveryBody, /revalidatePath\(`\/back-office\/receipts\/\$\{receiptId\}`\)/);
  assert.match(schema, /@tindio\/contracts\/receipt-settings/);
  assert.match(schema, /@tindio\/contracts\/receipt-delivery/);
  assert.ok(service.indexOf("hasPermission(context, \"settings.manage\")") < service.indexOf("receiptSettingsSchema.safeParse(input)"));
  assert.match(service, /supabase\.rpc\(POS_RECEIPT_SETTINGS_RPC/);
  assert.ok(service.indexOf("hasPermission(context, \"receipts.reprint\")") < service.indexOf("receiptDeliverySchema.safeParse(input)"));
  assert.match(service, /supabase\.rpc\(POS_RECEIPT_DELIVERY_RPC/);
  assert.match(service, /receiptDeliverySuccessMessage\(result\)/);
});

test("Backend receipt-administration oracle remains network-independent beside owned routes", async () => {
  const oracle = await read("apps/backend/src/pos/receipt-administration-compatibility.ts");
  for (const value of [
    "RECEIPT_ADMINISTRATION_COMPATIBILITY_CONTRACT",
    "validateReceiptSettings", "toReceiptSettingsRpcArguments", "mapReceiptSettingsRpcResult",
    "validateReceiptDelivery", "toReceiptDeliveryRpcArguments", "mapReceiptDeliveryRpcResult",
  ]) assert.match(oracle, new RegExp(`\\b${value}\\b`));
  assert.doesNotMatch(oracle, /fetch\(|createPosReadRuntime|createNeonDataApiFetch|@supabase|@neon|process\.env/);
  for (const path of [
    "apps/backend/api/pos/v2/receipt-settings.ts",
    "apps/backend/api/pos/v2/receipts/[receiptId]/delivery.ts",
  ]) assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true);
});

test("database authority retains settings snapshots and delivery scope, replay, and immutable custody", async () => {
  const baseline = await read("database/baseline/0001_tindio_baseline.sql");
  const settings = functionBody(baseline, "public", "update_receipt_settings");
  const delivery = functionBody(baseline, "public", "queue_receipt_delivery");
  const snapshot = functionBody(baseline, "private", "capture_receipt_layout_snapshot");
  assert.match(settings, /private\.has_permission\(target_organization_id, 'settings\.manage'\)/);
  assert.match(settings, /insert into public\.receipt_settings/);
  assert.match(settings, /on conflict \(organization_id\) do update/);
  assert.match(snapshot, /from public\.receipt_settings/);
  assert.match(baseline, /receipts_capture_layout_snapshot" BEFORE INSERT ON "public"\."receipts"/);
  assert.match(delivery, /private\.has_permission\(target_organization_id, 'receipts\.reprint'\)/);
  assert.match(delivery, /private\.has_sale_read_scope\(receipt\.organization_id, receipt\.sale_id\)/);
  assert.match(delivery, /existing_actor_employee_id is distinct from actor_employee_id/);
  assert.match(delivery, /existing_payload is distinct from canonical_payload/);
  assert.match(delivery, /insert into public\.receipt_delivery_requests/);
  assert.doesNotMatch(delivery, /update public\.receipts|delete from public\.receipts/i);
  assert.match(baseline, /receipt_delivery_requests_organization_key_unique" UNIQUE \("organization_id", "idempotency_key"\)/);
  for (const rpc of ["update_receipt_settings", "queue_receipt_delivery"]) {
    assert.match(baseline, new RegExp(`REVOKE ALL ON FUNCTION "public"\\."${rpc}"[\\s\\S]+?FROM PUBLIC;`));
    assert.match(baseline, new RegExp(`GRANT ALL ON FUNCTION "public"\\."${rpc}"[\\s\\S]+?TO "tindio_authenticated";`));
  }
});

test("D40 contracts remain intact after D41 ownership and adjacent mutations stay unchanged", async () => {
  const [action, exchangeRoute, attendance, refund, backendReadme] = await Promise.all([
    read("src/features/receipts/improvement-6-actions.ts"),
    read("apps/backend/api/pos/v2/exchanges/link.ts"),
    read("apps/backend/api/pos/v2/attendance/clock-in.ts"),
    read("apps/backend/api/pos/v2/receipts/[receiptId]/refund.ts"),
    read("apps/backend/README.md"),
  ]);
  assert.match(action, /^"use server";/);
  assert.match(action, /export async function updateReceiptSettingsAction/);
  assert.match(action, /export async function queueReceiptDeliveryAction/);
  for (const mutation of [exchangeRoute, attendance, refund]) assert.match(mutation, /export async function POST/);
  assert.match(backendReadme, /Slice D40 receipt-administration compatibility oracle/);
  assert.match(backendReadme, /Slice D40 receipt-administration compatibility oracle/);
});
