import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("checkout has a focused platform-neutral command contract", async () => {
  const [manifestSource, contract] = await Promise.all([
    read("packages/contracts/package.json"),
    read("packages/contracts/src/checkout.ts"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(manifest.exports["./checkout"].types, "./src/checkout.ts");
  for (const value of [
    "POS_CHECKOUT_PATH",
    "POS_CHECKOUT_RPC",
    "POS_CHECKOUT_STOCK_WARNING_RPC",
    "POS_CHECKOUT_PERMISSIONS",
    "POS_CHECKOUT_DISCOUNT_PERMISSION",
    "POS_CHECKOUT_TICKET_PERMISSION",
    "checkoutSaleSchema",
    "checkoutSubmissionSchema",
    "CheckoutSaleActionResult",
  ]) assert.match(contract, new RegExp(`\\b${value}\\b`));
  for (const value of [
    '"/api/pos/v2/checkout"',
    '"checkout_advanced_sale"',
    '"get_checkout_stock_warning"',
    '"pos.access"',
    '"sales.create"',
    '"payments.accept"',
    '"discounts.apply"',
    '"tickets.manage"',
  ]) assert.ok(contract.includes(value), `missing shared checkout value ${value}`);
  assert.doesNotMatch(
    contract,
    /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/,
  );
});

test("Web checkout remains the rollback authority and consumes the frozen schema", async () => {
  const [route, service, schema] = await Promise.all([
    read("src/app/api/pos/v2/checkout/route.ts"),
    read("src/features/checkout/checkout-service.ts"),
    read("src/features/checkout/checkout-schema.ts"),
  ]);

  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function (?:GET|PUT|PATCH|DELETE)/);
  assert.ok(route.indexOf("request.json()") < route.indexOf("getPosV2BusinessContext(request)"));
  assert.match(route, /completeCheckout\(context, input\)/);
  assert.match(route, /result\.ok \? 200 : result\.retryable \? 503 : 409/);
  assert.match(route, /Check Recent receipts before retrying/);
  assert.match(schema, /@tindio\/contracts\/checkout/);
  for (const permission of ["pos.access", "sales.create", "payments.accept", "discounts.apply", "tickets.manage"]) {
    assert.ok(service.includes(`hasPermission(context, "${permission}")`));
  }
  assert.match(service, /context\.storeIds\.includes\(parsed\.storeId\)/);
  assert.match(service, /posDeviceRequestHeaders\(wrapped\.success \? wrapped\.data\.device : null\)/);
  assert.match(service, /\.rpc\("checkout_advanced_sale"/);
  assert.match(service, /\.rpc\("get_checkout_stock_warning"/);
});

test("Backend checkout oracle remains network and database independent without an owned route", async () => {
  const oracle = await read("apps/backend/src/pos/checkout-compatibility.ts");

  assert.match(oracle, /CHECKOUT_COMPATIBILITY_CONTRACT/);
  assert.match(oracle, /validateCheckout/);
  assert.match(oracle, /toCheckoutRpcArguments/);
  assert.match(oracle, /mapCheckoutRpcResult/);
  assert.doesNotMatch(
    oracle,
    /fetch\(|createPosReadRuntime|createNeonDataApiFetch|@supabase|@neon|process\.env/,
  );
  assert.equal(
    existsSync(new URL("../apps/backend/api/pos/v2/checkout.ts", import.meta.url)),
    false,
  );
});

test("database authority retains atomic checkout, replay, custody, payment, stock, and ledger rules", async () => {
  const [baseline, providerNeutral] = await Promise.all([
    read("database/baseline/0001_tindio_baseline.sql"),
    read("database/migrations/0003_provider_neutral_roles_rls.sql"),
  ]);
  const privateStart = baseline.indexOf(
    'CREATE OR REPLACE FUNCTION "private"."checkout_advanced_sale"',
  );
  const privateEnd = baseline.indexOf("-- Name: checkout_cash_sale", privateStart);
  const privateBody = baseline.slice(privateStart, privateEnd);
  const publicStart = baseline.indexOf(
    'CREATE OR REPLACE FUNCTION "public"."checkout_advanced_sale"',
  );
  const publicEnd = baseline.indexOf("-- Name: checkout_cash_sale", publicStart);
  const publicBody = baseline.slice(publicStart, publicEnd);

  assert.ok(privateStart >= 0 && privateEnd > privateStart);
  assert.ok(publicStart >= 0 && publicEnd > publicStart);
  assert.match(privateBody, /SECURITY DEFINER/);
  assert.match(privateBody, /advanced_checkout_requests[\s\S]+idempotency_key = target_idempotency_key[\s\S]+for update/);
  assert.match(privateBody, /existing_request\.request_payload is distinct from request_payload/);
  assert.match(privateBody, /existing_request\.sale_id is null[\s\S]+errcode = '40001'/);
  assert.ok(privateBody.indexOf("if found then") < privateBody.indexOf("private.require_active_pos_shift"));
  assert.match(privateBody, /private\.require_active_pos_shift/);
  assert.match(privateBody, /private\.checkout_sale\(/);
  assert.match(privateBody, /insert into public\.sale_items/);
  assert.match(privateBody, /insert into public\.payments/);
  assert.match(privateBody, /Payments must exactly cover the sale total before completion/);
  assert.match(privateBody, /insert into public\.loyalty_transactions/);
  assert.match(privateBody, /update public\.open_tickets set status = 'completed'/);
  assert.match(privateBody, /update public\.advanced_checkout_requests set state = 'completed'/);
  assert.match(publicBody, /array\['pos\.access', 'sales\.create', 'payments\.accept'\]/);
  assert.match(publicBody, /target_discount_id is not null[\s\S]+array\['discounts\.apply'\]/);
  assert.match(publicBody, /target_open_ticket_id is not null[\s\S]+array\['tickets\.manage'\]/);
  assert.match(
    providerNeutral,
    /GRANT ALL ON FUNCTION "public"\."checkout_advanced_sale"[^;]+TO "tindio_authenticated"/s,
  );
  assert.match(baseline, /insert into public\.inventory_movements[\s\S]+?'SALE'[\s\S]+?'sale'/s);
  assert.match(baseline, /insert into public\.receipts[\s\S]+new_receipt_number/s);
  assert.match(baseline, /private\.consume_made_to_order_composite_sale/);
});

test("D26 shares the checkout path without moving clients or adjacent financial mutations", async () => {
  const [mobileApi, webPayment, backendReadme, refund, transfer, attendance, sync] = await Promise.all([
    read("apps/mobile/src/lib/tindio-api.ts"),
    read("src/features/checkout/payment-screen.tsx"),
    read("apps/backend/README.md"),
    read("src/app/api/pos/v2/receipts/[receiptId]/refund/route.ts"),
    read("src/app/api/pos/v2/transfers/[transferId]/receive/route.ts"),
    read("src/app/api/pos/v2/attendance/clock-in/route.ts"),
    read("src/app/api/pos/v2/sync/push/route.ts"),
  ]);

  assert.match(mobileApi, /request\(POS_CHECKOUT_PATH/);
  assert.match(mobileApi, /@tindio\/contracts\/checkout/);
  assert.match(webPayment, /fetchPosV2Command\(POS_CHECKOUT_PATH/);
  assert.match(webPayment, /@tindio\/contracts\/checkout/);
  assert.doesNotMatch(mobileApi, /TINDIO_WEB_API_ORIGIN|apps\/backend/);
  for (const mutation of [refund, transfer, attendance, sync]) {
    assert.match(mutation, /export async function POST/);
  }
  assert.match(backendReadme, /Slice D26 checkout compatibility oracle/);
});
