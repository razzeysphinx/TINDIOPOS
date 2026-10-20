import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Backend owns only the favorite-tile POST mutation", async () => {
  const [route, service, environment] = await Promise.all([
    read("apps/backend/api/pos/v2/favorites.ts"),
    read("apps/backend/src/pos/favorite-tile-service.ts"),
    read("apps/backend/.env.example"),
  ]);

  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function (?:GET|PUT|PATCH|DELETE)/);
  assert.match(route, /TINDIO_FAVORITE_TILE_UPDATE_MODE/);
  assert.match(service, /options\.mode \?\? ["']owned["']/);
  assert.match(service, /mode === ["']proxy["']/);
  assert.match(environment, /^TINDIO_FAVORITE_TILE_UPDATE_MODE=owned$/m);
});

test("owned favorite tile preserves context, ordering, envelopes, and result mapping", async () => {
  const owned = await read("apps/backend/src/pos/favorite-tile-owned.ts");

  for (const value of [
    "verifyClaims",
    "loadCore",
    "IDENTITY_UNMAPPED",
    "ORGANIZATION_INACTIVE",
    "INVALID_BUSINESS_TYPE",
    "POS_FAVORITE_TILE_PERMISSION",
    "POS_FAVORITE_TILE_REQUEST_INVALID_MESSAGE",
    "validateFavoriteTileUpdate",
    "updateFavorite",
    "mapFavoriteTileRpcResult",
    '"cache-control": "private, no-store"',
  ]) assert.ok(owned.includes(value), `missing owned behavior ${value}`);

  assert.ok(
    owned.indexOf("core.permissions.includes(POS_FAVORITE_TILE_PERMISSION)")
      < owned.indexOf("request.json()"),
    "permission checks must precede body parsing",
  );
  assert.ok(
    owned.indexOf("request.json()") < owned.indexOf("updateFavorite("),
    "body validation must precede the mutation",
  );
  assert.match(owned, /POS_FAVORITE_TILE_REQUEST_INVALID_MESSAGE[\s\S]+400/);
  assert.doesNotMatch(owned, /service[_-]?role|DATABASE_URL/i);
});

test("favorite-tile command runtime verifies Supabase claims and mutates only through Neon", async () => {
  const [runtime, adapter] = await Promise.all([
    read("apps/backend/src/pos/favorite-tile-runtime.ts"),
    read("apps/backend/src/database/neon-data-api-fetch.ts"),
  ]);

  assert.match(runtime, /authClient\.auth\.getClaims\(token\)/);
  assert.match(runtime, /createNeonDataApiFetch/);
  assert.match(runtime, /get_pos_bootstrap_core_v2/);
  assert.match(runtime, /POS_FAVORITE_TILE_RPC/);
  for (const argument of [
    "target_organization_id",
    "target_store_id",
    "target_product_id",
    "target_variant_id",
    "target_is_favorite",
  ]) assert.match(runtime, new RegExp(`\\b${argument}\\b`));
  assert.match(adapter, /rewritten\.headers\.delete\(["']apikey["']\)/);
  assert.doesNotMatch(runtime, /service[_-]?role|DATABASE_URL/i);
});

test("favorite-tile rollback preserves body and rejects loops and ambient credentials", async () => {
  const proxy = await read("apps/backend/src/pos/favorite-tile-proxy.ts");

  assert.match(proxy, /POS_FAVORITE_TILE_PATH/);
  assert.match(proxy, /url\.search = requestUrl\.search/);
  assert.match(proxy, /upstream\.origin === requestUrl\.origin/);
  assert.match(proxy, /method:\s*["']POST["']/);
  assert.match(proxy, /body:\s*await request\.arrayBuffer\(\)/);
  assert.match(proxy, /redirect:\s*["']manual["']/);
  assert.match(proxy, /cache:\s*["']no-store["']/);
  for (const header of [
    "accept",
    "authorization",
    "content-type",
    "x-tindio-organization-id",
    "cache-control",
    "retry-after",
    "x-tindio-request-id",
  ]) assert.match(proxy, new RegExp(`["']${header}["']`));
  assert.doesNotMatch(proxy, /headers\s*:\s*request\.headers|["']cookie["']/);
});

test("D13 converges the POS client and leaves higher-risk mutations and origins unchanged", async () => {
  const [webRoute, browserApi, terminal, actions, checkout, refund, transfer, ticket, attendance, sync, mobile, readme] =
    await Promise.all([
      read("src/app/api/pos/v2/favorites/route.ts"),
      read("src/features/pos/pos-v2-browser-api.ts"),
      read("src/features/pos/pos-terminal.tsx"),
      read("src/features/pos/actions.ts"),
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
  assert.match(browserApi, /export async function updatePosFavoriteTile/);
  assert.match(browserApi, /["']\/api\/pos\/v2\/favorites["']/);
  assert.match(terminal, /updatePosFavoriteTile\(organizationId/);
  assert.doesNotMatch(actions, /setPosFavoriteTileAction/);
  for (const mutation of [checkout, refund, transfer, ticket, attendance, sync]) {
    assert.match(mutation, /export async function POST/);
  }
  assert.doesNotMatch(mobile, /TINDIO_WEB_API_ORIGIN|apps\/backend/);
  assert.match(readme, /No financial, custody, attendance, or offline-replayed mutation/);
});
