import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Backend owns only the customer-creation POST mutation", async () => {
  const [route, service, environment] = await Promise.all([
    read("apps/backend/api/pos/v2/customers/create.ts"),
    read("apps/backend/src/pos/customer-creation-service.ts"),
    read("apps/backend/.env.example"),
  ]);
  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function (?:GET|PUT|PATCH|DELETE)/);
  assert.match(route, /TINDIO_CUSTOMER_CREATION_MODE/);
  assert.match(service, /options\.mode \?\? ["']owned["']/);
  assert.match(service, /mode === ["']proxy["']/);
  assert.match(environment, /^TINDIO_CUSTOMER_CREATION_MODE=owned$/m);
});

test("owned customer creation preserves context, ordering, envelopes, and mapping", async () => {
  const owned = await read("apps/backend/src/pos/customer-creation-owned.ts");
  for (const value of [
    "verifyClaims", "loadCore", "IDENTITY_UNMAPPED", "ORGANIZATION_INACTIVE",
    "INVALID_BUSINESS_TYPE", "POS_CUSTOMER_CREATION_PERMISSION",
    "POS_CUSTOMER_CREATION_REQUEST_INVALID_MESSAGE", "validateCustomerCreation",
    "createCustomer", "customerCreationDatabaseFailure", "mapCreatedCustomer",
    '"cache-control": "private, no-store"',
  ]) assert.ok(owned.includes(value), `missing owned behavior ${value}`);
  assert.ok(
    owned.indexOf("core.permissions.includes(POS_CUSTOMER_CREATION_PERMISSION)")
      < owned.indexOf("request.json()"),
    "permission checks must precede body parsing",
  );
  assert.ok(
    owned.indexOf("request.json()") < owned.indexOf("dependencies.createCustomer("),
    "body validation must precede the mutation",
  );
  assert.match(owned, /POS_CUSTOMER_CREATION_REQUEST_INVALID_MESSAGE[\s\S]+400/);
  assert.doesNotMatch(owned, /service[_-]?role|DATABASE_URL/i);
});

test("customer-creation runtime verifies Supabase claims and writes only through Neon", async () => {
  const [runtime, adapter] = await Promise.all([
    read("apps/backend/src/pos/customer-creation-runtime.ts"),
    read("apps/backend/src/database/neon-data-api-fetch.ts"),
  ]);
  assert.match(runtime, /authClient\.auth\.getClaims\(token\)/);
  assert.match(runtime, /createNeonDataApiFetch/);
  assert.match(runtime, /get_pos_bootstrap_core_v2/);
  assert.match(runtime, /\.from\(POS_CUSTOMER_CREATION_TABLE\)/);
  assert.match(runtime, /\.select\(POS_CUSTOMER_CREATION_SELECT\)/);
  for (const field of [
    "organization_id", "full_name", "email", "phone", "address",
    "birthday", "notes", "loyalty_card_code",
  ]) assert.match(runtime, new RegExp(`\\b${field}\\b`));
  assert.match(adapter, /rewritten\.headers\.delete\(["']apikey["']\)/);
  assert.doesNotMatch(runtime, /service[_-]?role|DATABASE_URL/i);
});

test("customer-creation rollback preserves body and rejects ambient credentials", async () => {
  const proxy = await read("apps/backend/src/pos/customer-creation-proxy.ts");
  assert.match(proxy, /POS_CUSTOMER_CREATION_PATH/);
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
  assert.doesNotMatch(proxy, /headers\s*:\s*request\.headers|["']cookie["']/);
});

test("D15 converges Web clients and leaves higher-risk mutations and origins unchanged", async () => {
  const [webRoute, browserApi, picker, forms, actions, page, checkout, refund, transfer, ticket, attendance, sync, mobile, readme] =
    await Promise.all([
      read("src/app/api/pos/v2/customers/create/route.ts"),
      read("src/features/pos/pos-v2-browser-api.ts"),
      read("src/features/customers/pos-customer-picker.tsx"),
      read("src/features/customers/customer-forms.tsx"),
      read("src/features/customers/actions.ts"),
      read("src/app/(back-office)/back-office/customers/page.tsx"),
      read("src/app/api/pos/v2/checkout/route.ts"),
      read("src/app/api/pos/v2/receipts/[receiptId]/refund/route.ts"),
      read("src/app/api/pos/v2/transfers/[transferId]/receive/route.ts"),
      read("src/app/api/pos/v2/tickets/save/route.ts"),
      read("src/app/api/pos/v2/attendance/clock-in/route.ts"),
      read("src/app/api/pos/v2/sync/push/route.ts"),
      read("apps/mobile/src/lib/tindio-api.ts"),
      read("apps/backend/README.md"),
    ]);
  assert.match(webRoute, /export async function POST/);
  assert.match(browserApi, /export async function createPosV2Customer/);
  assert.match(browserApi, /POS_CUSTOMER_CREATION_PATH/);
  assert.match(picker, /createPosV2Customer\(organizationId/);
  assert.match(forms, /createPosV2Customer\(organizationId/);
  assert.doesNotMatch(actions, /createCustomerAction/);
  assert.match(page, /organizationId=\{context\.organization\.id\}/);
  for (const mutation of [checkout, refund, transfer, ticket, attendance, sync]) {
    assert.match(mutation, /export async function POST/);
  }
  assert.doesNotMatch(mobile, /TINDIO_WEB_API_ORIGIN|apps\/backend/);
  assert.match(readme, /No financial, custody, attendance, or offline-replayed mutation/);
});
