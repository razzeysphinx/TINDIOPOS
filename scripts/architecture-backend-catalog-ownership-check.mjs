import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Backend owns the bounded POS catalogue read", async () => {
  const [route, service, owned, runtime, sharedRuntime, environment] = await Promise.all([
    read("apps/backend/api/pos/v2/catalog.ts"),
    read("apps/backend/src/pos/catalog-service.ts"),
    read("apps/backend/src/pos/catalog-owned.ts"),
    read("apps/backend/src/pos/catalog-runtime.ts"),
    read("apps/backend/src/pos/pos-read-runtime.ts"),
    read("apps/backend/.env.example"),
  ]);

  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /POST|PUT|PATCH|DELETE/);
  assert.match(route, /TINDIO_CATALOG_READ_MODE/);
  assert.match(service, /options\.mode \?\? ["']owned["']/);
  assert.match(owned, /handleOwnedPosCatalog/);
  assert.match(runtime, /get_pos_catalog_v2/);
  assert.match(sharedRuntime, /authVerifier\.verifyAccessToken\(token\)/);
  assert.match(sharedRuntime, /createBackendAuthTokenVerifier/);
  assert.match(sharedRuntime, /createNeonDataApiFetch/);
  assert.match(environment, /^TINDIO_CATALOG_READ_MODE=owned$/m);
});

test("owned catalogue preserves validation, mode, paging, and response contracts", async () => {
  const owned = await read("apps/backend/src/pos/catalog-owned.ts");

  for (const value of [
    "CATALOG_QUERY_INVALID",
    "AUTH_REQUIRED",
    "AUTH_INVALID",
    "AUTH_PROVIDER_UNAVAILABLE",
    "ORGANIZATION_FORBIDDEN",
    "DATABASE_UNAVAILABLE",
    "INVALID_CATALOG_RESPONSE",
    "CATALOG_MODE_INVALID",
    "CATALOG_PAGE_INVALID",
    "IDENTITY_UNMAPPED",
    "search",
    "favorites",
    "recent",
    "private, no-store",
    "x-tindio-request-id",
  ]) {
    assert.match(owned, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(owned, /10_000/);
  assert.match(owned, /maximum:\s*number/);
  assert.match(owned, /version:\s*2/);
  assert.doesNotMatch(owned, /service[_-]?role|DATABASE_URL/i);
});

test("catalogue rollback proxy is loop-safe, query-preserving, and allowlisted", async () => {
  const [service, proxy] = await Promise.all([
    read("apps/backend/src/pos/catalog-service.ts"),
    read("apps/backend/src/pos/catalog-proxy.ts"),
  ]);

  assert.match(service, /mode === ["']proxy["']/);
  assert.match(proxy, /POS_CATALOG_PATH\s*=\s*["']\/api\/pos\/v2\/catalog["']/);
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

test("catalogue contract uses the focused cross-runtime package export", async () => {
  const [manifestSource, owned] = await Promise.all([
    read("packages/contracts/package.json"),
    read("apps/backend/src/pos/catalog-owned.ts"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(manifest.exports["./pos-data"].types, "./src/pos-data.ts");
  assert.match(owned, /from ["']@tindio\/contracts\/pos-data["']/);
  assert.doesNotMatch(owned, /from ["']@tindio\/contracts["']/);
});

test("Web route and supported clients remain on the current origin", async () => {
  const [webRoute, mobileApi, webApi, readme] = await Promise.all([
    read("src/app/api/pos/v2/catalog/route.ts"),
    read("apps/mobile/src/lib/tindio-api.ts"),
    read("src/features/pos/pos-v2-browser-api.ts"),
    read("apps/backend/README.md"),
  ]);

  assert.match(webRoute, /getPosV2Catalog/);
  assert.match(webRoute, /PosCatalogV2Response/);
  assert.match(mobileApi, /["'`]\/api\/pos\/v2\/catalog/);
  assert.match(webApi, /["'`]\/api\/pos\/v2\/catalog/);
  assert.doesNotMatch(`${mobileApi}\n${webApi}`, /TINDIO_WEB_API_ORIGIN|apps\/backend/);
  assert.match(readme, /No financial, custody, attendance, or offline-replayed mutation/);
});
