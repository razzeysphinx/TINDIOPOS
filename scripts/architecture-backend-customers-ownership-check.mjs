import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Backend owns the bounded POS customer search read", async () => {
  const [route, service, owned, runtime, sharedRuntime, environment] = await Promise.all([
    read("apps/backend/api/pos/v2/customers.ts"),
    read("apps/backend/src/pos/customers-service.ts"),
    read("apps/backend/src/pos/customers-owned.ts"),
    read("apps/backend/src/pos/customers-runtime.ts"),
    read("apps/backend/src/pos/pos-read-runtime.ts"),
    read("apps/backend/.env.example"),
  ]);

  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /POST|PUT|PATCH|DELETE/);
  assert.match(route, /TINDIO_CUSTOMERS_READ_MODE/);
  assert.match(service, /options\.mode \?\? ["']owned["']/);
  assert.match(owned, /handleOwnedPosCustomers/);
  assert.match(runtime, /get_pos_bootstrap_core_v2/);
  assert.match(runtime, /search_pos_customers/);
  assert.match(sharedRuntime, /auth\.getClaims\(token\)/);
  assert.match(sharedRuntime, /createNeonDataApiFetch/);
  assert.match(environment, /^TINDIO_CUSTOMERS_READ_MODE=owned$/m);
});

test("owned customer search preserves context, store, shift, and result limits", async () => {
  const [owned, runtime] = await Promise.all([
    read("apps/backend/src/pos/customers-owned.ts"),
    read("apps/backend/src/pos/customers-runtime.ts"),
  ]);

  for (const value of [
    "pos.access",
    "sales.create",
    "ORGANIZATION_INACTIVE",
    "INVALID_BUSINESS_TYPE",
    "Choose an assigned store.",
    "Open a register shift before looking up customers.",
    "INVALID_CUSTOMERS_RESPONSE",
    "customerNumber",
    "loyaltyCardCode",
    "loyaltyPoints",
    "private, no-store",
    "x-tindio-request-id",
  ]) {
    assert.match(owned, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(runtime, /findOpenShift/);
  assert.match(runtime, /target_limit:\s*8/);
  assert.doesNotMatch(`${owned}\n${runtime}`, /service[_-]?role|DATABASE_URL/i);
});

test("customer-search rollback proxy is loop-safe, query-preserving, and allowlisted", async () => {
  const [service, proxy] = await Promise.all([
    read("apps/backend/src/pos/customers-service.ts"),
    read("apps/backend/src/pos/customers-proxy.ts"),
  ]);

  assert.match(service, /mode === ["']proxy["']/);
  assert.match(proxy, /POS_CUSTOMERS_PATH\s*=\s*["']\/api\/pos\/v2\/customers["']/);
  assert.match(proxy, /url\.search = requestUrl\.search/);
  assert.match(proxy, /upstream\.origin === requestUrl\.origin/);
  assert.match(proxy, /redirect:\s*["']manual["']/);
  assert.match(proxy, /cache:\s*["']no-store["']/);

  for (const header of [
    "accept",
    "authorization",
    "x-tindio-organization-id",
    "cache-control",
    "content-type",
    "retry-after",
    "x-tindio-request-id",
  ]) {
    assert.match(proxy, new RegExp(`["']${header}["']`));
  }

  assert.doesNotMatch(proxy, /headers\s*:\s*request\.headers|["']cookie["']/);
});

test("customer search uses the focused cross-runtime data contract", async () => {
  const [manifestSource, owned] = await Promise.all([
    read("packages/contracts/package.json"),
    read("apps/backend/src/pos/customers-owned.ts"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(manifest.exports["./pos-data"].types, "./src/pos-data.ts");
  assert.match(owned, /from ["']@tindio\/contracts\/pos-data["']/);
  assert.doesNotMatch(owned, /from ["']@tindio\/contracts["']/);
});

test("Web customer route and supported clients remain on the current origin", async () => {
  const [webRoute, mobileApi, webPicker, readme] = await Promise.all([
    read("src/app/api/pos/v2/customers/route.ts"),
    read("apps/mobile/src/lib/tindio-api.ts"),
    read("src/features/customers/pos-customer-picker.tsx"),
    read("apps/backend/README.md"),
  ]);

  assert.match(webRoute, /search_pos_customers/);
  assert.match(webRoute, /target_limit:\s*8/);
  assert.match(mobileApi, /["'`]\/api\/pos\/v2\/customers/);
  assert.match(webPicker, /["'`]\/api\/pos\/v2\/customers/);
  assert.doesNotMatch(`${mobileApi}\n${webPicker}`, /TINDIO_WEB_API_ORIGIN|apps\/backend/);
  assert.match(readme, /No mutation route/);
});
