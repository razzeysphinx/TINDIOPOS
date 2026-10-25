import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Backend owns the POS reference read", async () => {
  const [route, service, owned, runtime, sharedRuntime, environment] = await Promise.all([
    read("apps/backend/api/pos/v2/reference.ts"),
    read("apps/backend/src/pos/reference-service.ts"),
    read("apps/backend/src/pos/reference-owned.ts"),
    read("apps/backend/src/pos/reference-runtime.ts"),
    read("apps/backend/src/pos/pos-read-runtime.ts"),
    read("apps/backend/.env.example"),
  ]);

  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /POST|PUT|PATCH|DELETE/);
  assert.match(route, /TINDIO_REFERENCE_READ_MODE/);
  assert.match(service, /options\.mode \?\? ["']owned["']/);
  assert.match(owned, /handleOwnedPosReference/);
  assert.match(runtime, /get_pos_reference_bundle_v2/);
  assert.match(sharedRuntime, /authVerifier\.verifyAccessToken\(token\)/);
  assert.match(sharedRuntime, /createBackendAuthTokenVerifier/);
  assert.match(sharedRuntime, /createNeonDataApiFetch/);
  assert.match(environment, /^TINDIO_REFERENCE_READ_MODE=owned$/m);
});

test("owned reference preserves the response and validation contract", async () => {
  const owned = await read("apps/backend/src/pos/reference-owned.ts");

  for (const value of [
    "AUTH_REQUIRED",
    "AUTH_INVALID",
    "AUTH_PROVIDER_UNAVAILABLE",
    "AUTH_INVALID_OR_UNAVAILABLE",
    "ORGANIZATION_FORBIDDEN",
    "DATABASE_UNAVAILABLE",
    "INVALID_REFERENCE_RESPONSE",
    "POS_CONTEXT_UNAVAILABLE",
    "IDENTITY_UNMAPPED",
    "x-tindio-reference-version",
    "x-tindio-request-id",
    "etag",
    "private, no-store",
  ]) {
    assert.match(owned, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const field of [
    "categories",
    "paymentMethods",
    "loyaltyProgram",
    "discounts",
    "taxRates",
    "diningOptions",
    "ticketTemplates",
  ]) {
    assert.match(owned, new RegExp(`value\\.${field}`));
  }

  assert.match(owned, /version:\s*2/);
  assert.doesNotMatch(owned, /service[_-]?role|authorizationHeader|DATABASE_URL/i);
});

test("reference rollback proxy is loop-safe and allowlisted", async () => {
  const [service, proxy] = await Promise.all([
    read("apps/backend/src/pos/reference-service.ts"),
    read("apps/backend/src/pos/reference-proxy.ts"),
  ]);

  assert.match(service, /mode === ["']proxy["']/);
  assert.match(proxy, /POS_REFERENCE_PATH\s*=\s*["']\/api\/pos\/v2\/reference["']/);
  assert.match(proxy, /upstream\.origin === requestUrl\.origin/);
  assert.match(proxy, /redirect:\s*["']manual["']/);
  assert.match(proxy, /cache:\s*["']no-store["']/);

  for (const header of [
    "accept",
    "authorization",
    "x-tindio-organization-id",
    "cache-control",
    "content-type",
    "etag",
    "retry-after",
    "x-tindio-reference-version",
    "x-tindio-request-id",
  ]) {
    assert.match(proxy, new RegExp(`["']${header}["']`));
  }

  assert.doesNotMatch(proxy, /headers\s*:\s*request\.headers|["']cookie["']/);
});

test("reference contract has a focused cross-runtime package export", async () => {
  const [manifestSource, owned] = await Promise.all([
    read("packages/contracts/package.json"),
    read("apps/backend/src/pos/reference-owned.ts"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(manifest.exports["./pos-data"].types, "./src/pos-data.ts");
  assert.match(owned, /import type \{ PosReferenceV2Response \} from ["']@tindio\/contracts\/pos-data["']/);
  assert.doesNotMatch(owned, /from ["']@tindio\/contracts["']/);
});

test("Web route and supported clients remain on the current origin", async () => {
  const [webRoute, mobileApi, webApi, readme] = await Promise.all([
    read("src/app/api/pos/v2/reference/route.ts"),
    read("apps/mobile/src/lib/tindio-api.ts"),
    read("src/features/pos/pos-v2-browser-api.ts"),
    read("apps/backend/README.md"),
  ]);

  assert.match(webRoute, /getPosV2Reference/);
  assert.match(webRoute, /PosReferenceV2Response/);
  assert.match(mobileApi, /request\(["']\/api\/pos\/v2\/reference["']/);
  assert.match(webApi, /["']\/api\/pos\/v2\/reference["']/);
  assert.doesNotMatch(`${mobileApi}\n${webApi}`, /TINDIO_WEB_API_ORIGIN|apps\/backend/);
  assert.match(readme, /No financial, custody, attendance, or offline-replayed mutation/);
});
