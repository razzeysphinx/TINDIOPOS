import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("favorite-tile mutation has a focused platform-neutral contract", async () => {
  const [manifestSource, contract] = await Promise.all([
    read("packages/contracts/package.json"),
    read("packages/contracts/src/favorite-tile.ts"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(manifest.exports["./favorite-tile"].types, "./src/favorite-tile.ts");
  for (const value of [
    "POS_FAVORITE_TILE_PATH",
    "POS_FAVORITE_TILE_RPC",
    "POS_FAVORITE_TILE_PERMISSION",
    "POS_FAVORITE_TILE_MAXIMUM",
    "POS_FAVORITE_TILE_REQUEST_INVALID_MESSAGE",
    "POS_FAVORITE_TILE_INPUT_MESSAGE",
    "POS_FAVORITE_TILE_PERMISSION_MESSAGE",
    "POS_FAVORITE_TILE_RPC_PERMISSION_MESSAGE",
    "POS_FAVORITE_TILE_SALEABLE_MESSAGE",
    "POS_FAVORITE_TILE_UPDATE_MESSAGE",
    "POS_FAVORITE_TILE_PINNED_MESSAGE",
    "POS_FAVORITE_TILE_REMOVED_MESSAGE",
    "favoriteTileSchema",
    "PosFavoriteTileUpdate",
    "PosFavoriteTileActionResult",
  ]) assert.match(contract, new RegExp(`\\b${value}\\b`));

  for (const value of [
    '"/api/pos/v2/favorites"',
    '"set_pos_favorite_tile"',
    '"products.manage"',
    "24",
    "z.uuid()",
    "z.uuid().nullable()",
    "z.boolean()",
  ]) assert.ok(contract.includes(value), `missing shared contract value ${value}`);

  assert.doesNotMatch(
    contract,
    /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/,
  );
});

test("Web rollback API and service consume the frozen contract", async () => {
  const [route, service, schemaFacade, typeFacade] = await Promise.all([
    read("src/app/api/pos/v2/favorites/route.ts"),
    read("src/features/pos/service.ts"),
    read("src/features/pos/pos-schema.ts"),
    read("src/features/pos/pos-types.ts"),
  ]);

  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function (?:GET|PUT|PATCH|DELETE)/);
  assert.match(route, /getPosV2BusinessContext\(request\)/);
  const handler = route.slice(route.indexOf("export async function POST"));
  assert.ok(handler.indexOf("getPosV2BusinessContext") < handler.indexOf("readPosApiJson"));
  assert.ok(handler.indexOf("hasPermission") < handler.indexOf("readPosApiJson"));
  assert.match(route, /hasPermission\(context, POS_FAVORITE_TILE_PERMISSION\)/);
  assert.match(route, /setPosFavoriteTile\(\{ context, input: body\.input \}\)/);

  assert.match(service, /favoriteTileSchema\.safeParse\(input\)/);
  assert.match(service, /context\.storeIds\.includes\(parsed\.data\.storeId\)/);
  assert.match(service, /supabase\.rpc\(POS_FAVORITE_TILE_RPC/);
  for (const argument of [
    "target_organization_id",
    "target_store_id",
    "target_product_id",
    "target_variant_id",
    "target_is_favorite",
  ]) assert.match(service, new RegExp(`\\b${argument}\\b`));
  assert.match(service, /data !== parsed\.data\.isFavorite/);

  for (const source of [route, service, schemaFacade, typeFacade]) {
    assert.match(source, /@tindio\/contracts\/favorite-tile/);
  }
});

test("Backend favorite-tile oracle remains isolated beside the owned route", async () => {
  const oracle = await read("apps/backend/src/pos/favorite-tile-compatibility.ts");

  assert.match(oracle, /from ["']@tindio\/contracts\/favorite-tile["']/);
  assert.match(oracle, /FAVORITE_TILE_COMPATIBILITY_CONTRACT/);
  assert.match(oracle, /validateFavoriteTileUpdate/);
  assert.match(oracle, /favoriteTilePermissionFailure/);
  assert.match(oracle, /mapFavoriteTileRpcResult/);
  assert.doesNotMatch(
    oracle,
    /fetch\(|createPosReadRuntime|createNeonDataApiFetch|\.rpc\(|process\.env/,
  );
  assert.equal(existsSync(new URL("../apps/backend/api/pos/v2/favorites.ts", import.meta.url)), true);
});

test("database authority retains access, saleability, ordering, idempotency, and role policy", async () => {
  const [baseline, providerNeutral] = await Promise.all([
    read("database/baseline/0001_tindio_baseline.sql"),
    read("database/migrations/0003_provider_neutral_roles_rls.sql"),
  ]);
  const functionStart = baseline.indexOf(
    'CREATE OR REPLACE FUNCTION "public"."set_pos_favorite_tile"',
  );
  const functionEnd = baseline.indexOf(
    '-- Name: set_store_payment_method_configuration',
    functionStart,
  );
  const body = baseline.slice(functionStart, functionEnd);

  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  assert.match(body, /SECURITY DEFINER/);
  assert.match(body, /SET "search_path" TO ''/);
  assert.match(body, /private\.require_pos_workspace_access/);
  assert.match(body, /private\.has_permission\(target_organization_id, 'products\.manage'\)/);
  assert.match(body, /product\.status = 'active'/);
  assert.match(body, /setting\.is_available/);
  assert.match(body, /variant\.is_active/);
  assert.match(body, /product\.product_type = 'simple'/);
  assert.match(body, /product\.product_type = 'variable'/);
  assert.match(body, /pg_advisory_xact_lock/);
  assert.match(body, /generate_series\(1, 24\)/);
  assert.match(body, /if not exists \(/);
  assert.match(body, /insert into public\.pos_favorite_tiles/);
  assert.match(body, /delete from public\.pos_favorite_tiles/);
  assert.match(body, /return true/);
  assert.match(body, /return false/);

  assert.match(providerNeutral, /CREATE POLICY "pos_favorite_tiles_insert_catalog_users"[^;]+WITH CHECK[^;]+'products\.manage'/s);
  assert.match(providerNeutral, /CREATE POLICY "pos_favorite_tiles_delete_catalog_users"[^;]+USING[^;]+'products\.manage'/s);
  assert.match(providerNeutral, /CREATE POLICY "pos_favorite_tiles_update_catalog_users"[^;]+USING[^;]+WITH CHECK/s);
  assert.match(providerNeutral, /REVOKE ALL ON FUNCTION "public"\."set_pos_favorite_tile"[^;]+FROM "authenticated"/);
  assert.match(providerNeutral, /GRANT ALL ON FUNCTION "public"\."set_pos_favorite_tile"[^;]+TO "tindio_authenticated"/);
});

test("favorite-tile ownership leaves the client origin and higher-risk mutations unchanged", async () => {
  const [terminal, browserApi, actions, checkout, refund, syncPush, favoriteRoute] = await Promise.all([
    read("src/features/pos/pos-terminal.tsx"),
    read("src/features/pos/pos-v2-browser-api.ts"),
    read("src/features/pos/actions.ts"),
    read("src/app/api/pos/v2/checkout/route.ts"),
    read("src/app/api/pos/v2/receipts/[receiptId]/refund/route.ts"),
    read("src/app/api/pos/v2/sync/push/route.ts"),
    read("src/app/api/pos/v2/favorites/route.ts"),
  ]);

  assert.match(terminal, /updatePosFavoriteTile/);
  assert.match(browserApi, /["']\/api\/pos\/v2\/favorites["']/);
  assert.doesNotMatch(actions, /setPosFavoriteTileAction/);
  assert.match(favoriteRoute, /setPosFavoriteTile/);
  assert.match(checkout, /export async function POST/);
  assert.match(refund, /export async function POST/);
  assert.match(syncPush, /export async function POST/);
});
