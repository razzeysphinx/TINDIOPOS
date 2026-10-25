import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Backend owns the bounded POS modifiers read", async () => {
  const [route, service, owned, runtime, sharedRuntime, environment] = await Promise.all([
    read("apps/backend/api/pos/v2/modifiers.ts"),
    read("apps/backend/src/pos/modifiers-service.ts"),
    read("apps/backend/src/pos/modifiers-owned.ts"),
    read("apps/backend/src/pos/modifiers-runtime.ts"),
    read("apps/backend/src/pos/pos-read-runtime.ts"),
    read("apps/backend/.env.example"),
  ]);

  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /POST|PUT|PATCH|DELETE/);
  assert.match(route, /TINDIO_MODIFIERS_READ_MODE/);
  assert.match(service, /options\.mode \?\? ["']owned["']/);
  assert.match(owned, /handleOwnedPosModifiers/);
  assert.match(runtime, /get_pos_modifiers_v2/);
  assert.match(sharedRuntime, /authVerifier\.verifyAccessToken\(token\)/);
  assert.match(sharedRuntime, /createBackendAuthTokenVerifier/);
  assert.match(sharedRuntime, /createNeonDataApiFetch/);
  assert.match(environment, /^TINDIO_MODIFIERS_READ_MODE=owned$/m);
});

test("owned modifiers preserve query, selection, and response validation", async () => {
  const owned = await read("apps/backend/src/pos/modifiers-owned.ts");

  for (const value of [
    "MODIFIER_QUERY_INVALID",
    "AUTH_REQUIRED",
    "AUTH_INVALID",
    "AUTH_PROVIDER_UNAVAILABLE",
    "AUTH_INVALID_OR_UNAVAILABLE",
    "ORGANIZATION_FORBIDDEN",
    "DATABASE_UNAVAILABLE",
    "INVALID_MODIFIERS_RESPONSE",
    "POS_CONTEXT_UNAVAILABLE",
    "IDENTITY_UNMAPPED",
    "minSelections",
    "maxSelections",
    "priceMinor",
    "private, no-store",
    "x-tindio-request-id",
  ]) {
    assert.match(owned, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(owned, /version:\s*2/);
  assert.doesNotMatch(owned, /service[_-]?role|DATABASE_URL/i);
});

test("modifiers rollback proxy is loop-safe, query-preserving, and allowlisted", async () => {
  const [service, proxy] = await Promise.all([
    read("apps/backend/src/pos/modifiers-service.ts"),
    read("apps/backend/src/pos/modifiers-proxy.ts"),
  ]);

  assert.match(service, /mode === ["']proxy["']/);
  assert.match(proxy, /POS_MODIFIERS_PATH\s*=\s*["']\/api\/pos\/v2\/modifiers["']/);
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

test("modifiers use the focused cross-runtime cart export", async () => {
  const [manifestSource, cart, owned] = await Promise.all([
    read("packages/contracts/package.json"),
    read("packages/contracts/src/cart.ts"),
    read("apps/backend/src/pos/modifiers-owned.ts"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(manifest.exports["./cart"].types, "./src/cart.ts");
  assert.match(cart, /from ["']\.\/pos-data\.js["']/);
  assert.match(owned, /from ["']@tindio\/contracts\/cart["']/);
  assert.doesNotMatch(owned, /from ["']@tindio\/contracts["']/);
});

test("Web route and supported clients remain on the current origin", async () => {
  const [webRoute, mobileApi, webApi, readme] = await Promise.all([
    read("src/app/api/pos/v2/modifiers/route.ts"),
    read("apps/mobile/src/lib/tindio-api.ts"),
    read("src/features/pos/pos-v2-browser-api.ts"),
    read("apps/backend/README.md"),
  ]);

  assert.match(webRoute, /getPosV2Modifiers/);
  assert.match(webRoute, /PosModifiersV2Response/);
  assert.match(mobileApi, /["'`]\/api\/pos\/v2\/modifiers/);
  assert.match(webApi, /["'`]\/api\/pos\/v2\/modifiers/);
  assert.doesNotMatch(`${mobileApi}\n${webApi}`, /TINDIO_WEB_API_ORIGIN|apps\/backend/);
  assert.match(readme, /No financial, custody, attendance, or offline-replayed mutation/);
});
