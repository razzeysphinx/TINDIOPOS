import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Backend exposes the read-only bootstrap compatibility route", async () => {
  const [route, proxy, environmentExample] = await Promise.all([
    read("apps/backend/api/pos/v2/bootstrap.ts"),
    read("apps/backend/src/pos/bootstrap-proxy.ts"),
    read("apps/backend/.env.example"),
  ]);

  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /POST|PUT|PATCH|DELETE/);
  assert.match(route, /TINDIO_WEB_API_ORIGIN/);
  assert.match(environmentExample, /^TINDIO_WEB_API_ORIGIN=https:\/\/web\.example\.com$/m);
  assert.match(proxy, /POS_BOOTSTRAP_PATH\s*=\s*["']\/api\/pos\/v2\/bootstrap["']/);
  assert.match(proxy, /redirect:\s*["']manual["']/);
  assert.match(proxy, /cache:\s*["']no-store["']/);
  assert.doesNotMatch(proxy, /@\/|src\/app|src\/features|@supabase|@neon/);
});

test("proxy has an explicit request and response compatibility allowlist", async () => {
  const proxy = await read("apps/backend/src/pos/bootstrap-proxy.ts");

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
  assert.match(proxy, /BOOTSTRAP_UPSTREAM_UNAVAILABLE/);
});

test("existing Next.js bootstrap remains authoritative and unchanged in responsibility", async () => {
  const webRoute = await read("src/app/api/pos/v2/bootstrap/route.ts");

  assert.match(webRoute, /getPosV2Core/);
  assert.match(webRoute, /POS_ACCESS_FORBIDDEN/);
  assert.match(webRoute, /version:\s*2/);
  assert.match(webRoute, /x-tindio-request-id/);
  assert.doesNotMatch(webRoute, /TINDIO_WEB_API_ORIGIN|apps\/backend|bootstrap-proxy/);
});

test("clients retain the existing POS API origin and bootstrap path", async () => {
  const [mobileApi, webApi] = await Promise.all([
    read("apps/mobile/src/lib/tindio-api.ts"),
    read("src/features/pos/pos-v2-browser-api.ts"),
  ]);

  assert.match(mobileApi, /request\(["']\/api\/pos\/v2\/bootstrap["']/);
  assert.match(webApi, /["']\/api\/pos\/v2\/bootstrap["']/);
  assert.doesNotMatch(`${mobileApi}\n${webApi}`, /TINDIO_WEB_API_ORIGIN|apps\/backend/);
});
