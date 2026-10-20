import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("customer creation has a focused platform-neutral contract", async () => {
  const [manifestSource, contract] = await Promise.all([
    read("packages/contracts/package.json"),
    read("packages/contracts/src/customer-creation.ts"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(manifest.exports["./customer-creation"].types, "./src/customer-creation.ts");
  for (const value of [
    "POS_CUSTOMER_CREATION_PATH",
    "POS_CUSTOMER_CREATION_PERMISSION",
    "POS_CUSTOMER_CREATION_TABLE",
    "POS_CUSTOMER_CREATION_SELECT",
    "POS_CUSTOMER_CREATION_PERMISSION_MESSAGE",
    "POS_CUSTOMER_CREATION_REQUEST_INVALID_MESSAGE",
    "POS_CUSTOMER_CREATION_INPUT_MESSAGE",
    "POS_CUSTOMER_CREATION_DATABASE_MESSAGE",
    "POS_CUSTOMER_CREATION_SUCCESS_MESSAGE",
    "createCustomerSchema",
    "CreateCustomerValues",
    "PosCustomerCreationResult",
  ]) assert.match(contract, new RegExp(`\\b${value}\\b`));

  for (const value of [
    '"/api/pos/v2/customers/create"',
    '"customers.manage"',
    '"customers"',
    "z.string().trim().date()",
    "loyaltyCardCode",
  ]) assert.ok(contract.includes(value), `missing shared contract value ${value}`);
  assert.doesNotMatch(contract, /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/);
});

test("Web route, server action, and service consume the frozen contract", async () => {
  const [route, action, service, schemaFacade] = await Promise.all([
    read("src/app/api/pos/v2/customers/create/route.ts"),
    read("src/features/customers/actions.ts"),
    read("src/features/customers/service.ts"),
    read("src/features/customers/customer-schema.ts"),
  ]);

  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function (?:GET|PUT|PATCH|DELETE)/);
  const handler = route.slice(route.indexOf("export async function POST"));
  assert.ok(handler.indexOf("getPosV2BusinessContext") < handler.indexOf("readPosApiJson"));
  assert.ok(handler.indexOf("hasPermission") < handler.indexOf("readPosApiJson"));
  assert.match(route, /hasPermission\(context, POS_CUSTOMER_CREATION_PERMISSION\)/);
  assert.match(action, /hasPermission\(context, POS_CUSTOMER_CREATION_PERMISSION\)/);
  assert.match(service, /createCustomerSchema\.safeParse\(input\)/);
  assert.match(service, /\.from\(POS_CUSTOMER_CREATION_TABLE\)/);
  assert.match(service, /\.select\(POS_CUSTOMER_CREATION_SELECT\)/);
  for (const source of [route, action, service, schemaFacade]) {
    assert.match(source, /@tindio\/contracts\/customer-creation/);
  }
});

test("Backend customer-creation oracle is isolated and does not claim route ownership", async () => {
  const [oracle, backendEnv] = await Promise.all([
    read("apps/backend/src/pos/customer-creation-compatibility.ts"),
    read("apps/backend/.env.example"),
  ]);
  assert.match(oracle, /CUSTOMER_CREATION_COMPATIBILITY_CONTRACT/);
  assert.match(oracle, /validateCustomerCreation/);
  assert.match(oracle, /customerCreationPermissionFailure/);
  assert.match(oracle, /customerCreationDatabaseFailure/);
  assert.match(oracle, /mapCreatedCustomer/);
  assert.doesNotMatch(oracle, /fetch\(|createPosReadRuntime|createNeonDataApiFetch|\.from\(|process\.env/);
  assert.equal(existsSync(new URL("../apps/backend/api/pos/v2/customers/create.ts", import.meta.url)), false);
  assert.doesNotMatch(backendEnv, /CUSTOMER_CREATION/);
});

test("database authority retains customer RLS, generated identity, constraints, and uniqueness", async () => {
  const [baseline, providerNeutral] = await Promise.all([
    read("database/baseline/0001_tindio_baseline.sql"),
    read("database/migrations/0003_provider_neutral_roles_rls.sql"),
  ]);
  const functionStart = baseline.indexOf('CREATE OR REPLACE FUNCTION "private"."assign_customer_identity"');
  const functionEnd = baseline.indexOf("-- Name: assign_open_shift_to_refund", functionStart);
  const body = baseline.slice(functionStart, functionEnd);

  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  assert.match(body, /SECURITY DEFINER/);
  assert.match(body, /new\.customer_number <> 0/);
  assert.match(body, /pg_advisory_xact_lock/);
  assert.match(body, /max\(customer\.customer_number\)/);
  assert.match(body, /new\.loyalty_card_code/);
  assert.match(body, /'TND-' \|\| lpad\(new\.customer_number::text, 8, '0'\)/);
  assert.match(baseline, /CONSTRAINT "customers_full_name_length"/);
  assert.match(baseline, /CONSTRAINT "customers_email_length"/);
  assert.match(baseline, /CONSTRAINT "customers_phone_length"/);
  assert.match(baseline, /CONSTRAINT "customers_organization_customer_number_unique"/);
  assert.match(baseline, /customers_organization_loyalty_card_code_unique_idx/);
  assert.match(providerNeutral, /CREATE POLICY "customers_insert_manager"[^;]+WITH CHECK[^;]+'customers\.manage'/s);
  assert.match(providerNeutral, /CREATE POLICY "customers_select_manager"[^;]+USING[^;]+'customers\.manage'/s);
});

test("customer creation keeps existing Mobile HTTP and Web server-action entry points", async () => {
  const [mobileApi, mobilePos, webPicker, backOfficeForm, checkout, refund, syncPush] = await Promise.all([
    read("apps/mobile/src/lib/tindio-api.ts"),
    read("apps/mobile/app/(app)/pos.tsx"),
    read("src/features/customers/pos-customer-picker.tsx"),
    read("src/features/customers/customer-forms.tsx"),
    read("src/app/api/pos/v2/checkout/route.ts"),
    read("src/app/api/pos/v2/receipts/[receiptId]/refund/route.ts"),
    read("src/app/api/pos/v2/sync/push/route.ts"),
  ]);
  assert.match(mobileApi, /request\(POS_CUSTOMER_CREATION_PATH/);
  assert.match(mobilePos, /createPosV2Customer/);
  assert.match(webPicker, /createCustomerAction/);
  assert.match(backOfficeForm, /createCustomerAction/);
  assert.match(checkout, /export async function POST/);
  assert.match(refund, /export async function POST/);
  assert.match(syncPush, /export async function POST/);
});
