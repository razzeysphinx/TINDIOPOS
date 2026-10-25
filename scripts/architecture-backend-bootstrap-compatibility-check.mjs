import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Backend owns bootstrap authentication and Neon core loading", async () => {
  const [route, service, owned, runtime, posReadRuntime, environmentExample] = await Promise.all([
    read("apps/backend/api/pos/v2/bootstrap.ts"),
    read("apps/backend/src/pos/bootstrap-service.ts"),
    read("apps/backend/src/pos/bootstrap-owned.ts"),
    read("apps/backend/src/pos/bootstrap-runtime.ts"),
    read("apps/backend/src/pos/pos-read-runtime.ts"),
    read("apps/backend/.env.example"),
  ]);

  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /POST|PUT|PATCH|DELETE/);
  assert.match(route, /createOwnedBootstrapDependencies/);
  assert.match(route, /TINDIO_BOOTSTRAP_READ_MODE/);
  assert.match(service, /options\.mode \?\? ["']owned["']/);
  assert.match(owned, /Bearer \(\[\^\\s\]\+\)/);
  assert.match(posReadRuntime, /authVerifier\.verifyAccessToken\(token\)/);
  assert.match(posReadRuntime, /createBackendAuthTokenVerifier/);
  assert.match(runtime, /get_pos_bootstrap_core_v2/);
  assert.match(posReadRuntime, /createNeonDataApiFetch/);
  assert.match(environmentExample, /^TINDIO_BOOTSTRAP_READ_MODE=owned$/m);
  assert.match(environmentExample, /^SUPABASE_URL=/m);
  assert.match(environmentExample, /^SUPABASE_PUBLISHABLE_KEY=/m);
  assert.match(environmentExample, /^NEON_DATA_API_URL=/m);
});

test("Backend-owned response preserves the established safe contract", async () => {
  const owned = await read("apps/backend/src/pos/bootstrap-owned.ts");

  for (const value of [
    "AUTH_REQUIRED",
    "AUTH_INVALID",
    "AUTH_PROVIDER_UNAVAILABLE",
    "AUTH_INVALID_OR_UNAVAILABLE",
    "ORGANIZATION_FORBIDDEN",
    "DATABASE_UNAVAILABLE",
    "INVALID_CORE_RESPONSE",
    "POS_CONTEXT_UNAVAILABLE",
    "POS_ACCESS_FORBIDDEN",
    "pos.access",
    "sales.create",
    "private, no-store",
    "x-tindio-request-id",
  ]) {
    assert.match(owned, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(owned, /version:\s*2/);
  assert.match(owned, /core,/);
  assert.doesNotMatch(owned, /authorizationHeader|email|service_role|secret/i);
});

test("compatibility proxy remains an explicit allowlisted rollback", async () => {
  const [route, service, proxy, environmentExample] = await Promise.all([
    read("apps/backend/api/pos/v2/bootstrap.ts"),
    read("apps/backend/src/pos/bootstrap-service.ts"),
    read("apps/backend/src/pos/bootstrap-proxy.ts"),
    read("apps/backend/.env.example"),
  ]);

  assert.match(route, /TINDIO_WEB_API_ORIGIN/);
  assert.match(service, /mode === ["']proxy["']/);
  assert.match(environmentExample, /^TINDIO_WEB_API_ORIGIN=https:\/\/web\.example\.com$/m);
  assert.match(proxy, /POS_BOOTSTRAP_PATH\s*=\s*["']\/api\/pos\/v2\/bootstrap["']/);
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

  assert.doesNotMatch(proxy, /headers\s*:\s*request\.headers/);
  assert.doesNotMatch(proxy, /["']cookie["']/);
  assert.match(proxy, /upstream\.origin === requestUrl\.origin/);
});

test("provider boundary keeps Auth and database credentials separated", async () => {
  const [runtime, adapter, allBackendSource] = await Promise.all([
    read("apps/backend/src/pos/pos-read-runtime.ts"),
    read("apps/backend/src/database/neon-data-api-fetch.ts"),
    Promise.all([
      "apps/backend/api/pos/v2/bootstrap.ts",
      "apps/backend/src/pos/bootstrap-runtime.ts",
      "apps/backend/src/pos/pos-read-runtime.ts",
      "apps/backend/src/pos/bootstrap-owned.ts",
      "apps/backend/src/pos/bootstrap-service.ts",
      "apps/backend/src/pos/bootstrap-proxy.ts",
      "apps/backend/src/database/neon-data-api-fetch.ts",
    ].map(read)).then((files) => files.join("\n")),
  ]);

  assert.match(adapter, /rewritten\.headers\.delete\([\s\S]*["']apikey["']/);
  assert.match(runtime, /accessToken:\s*async \(\) => token/);
  assert.doesNotMatch(allBackendSource, /service[_-]?role|DATABASE_URL|SUPABASE_SECRET/i);
  assert.doesNotMatch(allBackendSource, /@\/|src\/app|src\/features/);
});

test("Web compatibility route, clients, and mutation ownership remain unchanged", async () => {
  const [webRoute, mobileApi, webApi, backendFiles] = await Promise.all([
    read("src/app/api/pos/v2/bootstrap/route.ts"),
    read("apps/mobile/src/lib/tindio-api.ts"),
    read("src/features/pos/pos-v2-browser-api.ts"),
    read("apps/backend/README.md"),
  ]);

  assert.match(webRoute, /getPosV2Core/);
  assert.match(webRoute, /POS_ACCESS_FORBIDDEN/);
  assert.match(webRoute, /version:\s*2/);
  assert.match(mobileApi, /request\(["']\/api\/pos\/v2\/bootstrap["']/);
  assert.match(webApi, /["']\/api\/pos\/v2\/bootstrap["']/);
  assert.doesNotMatch(`${mobileApi}\n${webApi}`, /TINDIO_WEB_API_ORIGIN|apps\/backend/);
  assert.match(backendFiles, /No financial, custody, attendance, or offline-replayed mutation/);
});
