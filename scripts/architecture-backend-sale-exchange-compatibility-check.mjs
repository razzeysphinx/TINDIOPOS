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

test("sale exchange has a focused platform-neutral shared contract", async () => {
  const [manifestSource, index, contract] = await Promise.all([
    read("packages/contracts/package.json"),
    read("packages/contracts/src/index.ts"),
    read("packages/contracts/src/sale-exchange.ts"),
  ]);
  const manifest = JSON.parse(manifestSource);
  assert.equal(manifest.exports["./sale-exchange"].types, "./src/sale-exchange.ts");
  assert.match(index, /export \* from "\.\/sale-exchange"/);
  for (const value of [
    "POS_SALE_EXCHANGE_PATH", "POS_SALE_EXCHANGE_RPC", "POS_SALE_EXCHANGE_PERMISSIONS", "saleExchangeSchema",
    "SaleExchangeValues", "SaleExchangeDatabaseRow", "SaleExchangeResult",
    "saleExchangeSuccessMessage",
  ]) assert.match(contract, new RegExp(`\\b${value}\\b`));
  assert.match(contract, /Number\.MAX_SAFE_INTEGER/);
  assert.doesNotMatch(contract, /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/);
});

test("Web action retains context-first permissions, shared validation, RPC, and revalidation", async () => {
  const [action, schema, service] = await Promise.all([
    read("src/features/receipts/improvement-6-actions.ts"),
    read("src/features/receipts/improvement-6-schema.ts"),
    read("src/features/receipts/service.ts"),
  ]);
  const start = action.indexOf("export async function linkSaleExchangeAction");
  const body = action.slice(start);
  assert.ok(start >= 0);
  assert.ok(body.indexOf("requireBusinessContext()") < body.indexOf("linkSaleExchange({ context, input })"));
  assert.match(schema, /@tindio\/contracts\/sale-exchange/);
  assert.ok(service.indexOf("hasPermission(context, \"sales.create\")") < service.indexOf("saleExchangeSchema.safeParse(input)"));
  assert.match(service, /supabase\.rpc\(POS_SALE_EXCHANGE_RPC/);
  assert.match(service, /saleExchangeSuccessMessage\(result\)/);
  assert.match(body, /revalidatePath\("\/back-office\/receipts"\)/);
  assert.match(body, /revalidatePath\("\/back-office\/receipts\/\[receiptId\]", "page"\)/);
});

test("Backend sale-exchange oracle remains network-independent beside the owned route", async () => {
  const oracle = await read("apps/backend/src/pos/sale-exchange-compatibility.ts");
  for (const value of [
    "SALE_EXCHANGE_COMPATIBILITY_CONTRACT", "validateSaleExchange",
    "toSaleExchangeRpcArguments", "mapSaleExchangeRpcResult",
  ]) assert.match(oracle, new RegExp(`\\b${value}\\b`));
  assert.doesNotMatch(oracle, /fetch\(|createPosReadRuntime|createNeonDataApiFetch|@supabase|@neon|process\.env/);
  assert.equal(existsSync(new URL("../apps/backend/api/pos/v2/exchanges/link.ts", import.meta.url)), true);
});

test("database authority retains completed identities, actor custody, replay, uniqueness, and immutable linking", async () => {
  const baseline = await read("database/baseline/0001_tindio_baseline.sql");
  const link = functionBody(baseline, "public", "link_sale_exchange");
  assert.match(link, /private\.has_permission\(target_organization_id, 'sales\.refund'\)/);
  assert.match(link, /private\.has_permission\(target_organization_id, 'sales\.create'\)/);
  assert.match(link, /employee\.status = 'active'/);
  assert.match(link, /exchange\.idempotency_key = target_idempotency_key/);
  assert.match(link, /existing_payload is distinct from canonical_payload/);
  assert.match(link, /refund\.status = 'completed'/);
  assert.match(link, /sale\.status = 'completed'/);
  assert.match(link, /replacement_sale_record\.id = original_sale_id/);
  assert.match(link, /insert into public\.sale_exchanges/);
  assert.doesNotMatch(link, /update public\.(?:sales|refunds)|delete from public\.(?:sales|refunds)/i);
  assert.match(baseline, /sale_exchanges_organization_key_unique" UNIQUE \("organization_id", "idempotency_key"\)/);
  assert.match(baseline, /sale_exchanges_organization_refund_unique" UNIQUE \("organization_id", "refund_id"\)/);
  assert.match(baseline, /sale_exchanges_organization_replacement_sale_unique" UNIQUE \("organization_id", "replacement_sale_id"\)/);
  assert.match(baseline, /REVOKE ALL ON FUNCTION "public"\."link_sale_exchange"[\s\S]+?FROM PUBLIC;/);
  assert.match(baseline, /GRANT ALL ON FUNCTION "public"\."link_sale_exchange"[\s\S]+?TO "tindio_authenticated";/);
});

test("D38 contract remains intact after D39 ownership while adjacent receipt boundaries stay unchanged", async () => {
  const [action, route, settingsSchema, deliveryService, backendReadme] = await Promise.all([
    read("src/features/receipts/improvement-6-actions.ts"),
    read("src/app/api/pos/v2/exchanges/link/route.ts"),
    read("src/features/receipts/improvement-6-schema.ts"),
    read("src/features/receipts/service.ts"),
    read("apps/backend/README.md"),
  ]);
  assert.match(action, /^"use server";/);
  assert.match(action, /linkSaleExchange\(\{ context, input \}\)/);
  assert.match(route, /export async function POST/);
  assert.match(action, /export async function updateReceiptSettingsAction/);
  assert.match(action, /export async function queueReceiptDeliveryAction/);
  assert.match(settingsSchema, /export const receiptSettingsSchema/);
  assert.match(settingsSchema, /export const receiptDeliverySchema/);
  assert.match(deliveryService, /queueReceiptDelivery/);
  assert.match(backendReadme, /Slice D38 sale-exchange compatibility oracle/);
});
