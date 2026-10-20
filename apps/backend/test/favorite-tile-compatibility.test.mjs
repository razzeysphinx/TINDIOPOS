import assert from "node:assert/strict";
import test from "node:test";

import {
  FAVORITE_TILE_COMPATIBILITY_CONTRACT,
  favoriteTilePermissionFailure,
  mapFavoriteTileRpcResult,
  validateFavoriteTileUpdate,
} from "../dist/src/pos/favorite-tile-compatibility.js";

const STORE_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const VARIANT_ID = "33333333-3333-4333-8333-333333333333";

test("favorite-tile compatibility freezes method, path, permission, RPC, response, and capacity", () => {
  assert.deepEqual(FAVORITE_TILE_COMPATIBILITY_CONTRACT, {
    method: "POST",
    path: "/api/pos/v2/favorites",
    permission: "products.manage",
    rpc: "set_pos_favorite_tile",
    rpcArguments: [
      "target_organization_id",
      "target_store_id",
      "target_product_id",
      "target_variant_id",
      "target_is_favorite",
    ],
    maximumTiles: 24,
    actionResponse: {
      status: 200,
      headers: { "cache-control": "private, no-store" },
    },
    malformedJsonResponse: {
      status: 400,
      headers: { "cache-control": "private, no-store" },
      body: { ok: false, message: "The request data is invalid." },
    },
  });
});

test("favorite-tile compatibility accepts pin and unpin with nullable variants", () => {
  for (const isFavorite of [true, false]) {
    for (const variantId of [VARIANT_ID, null]) {
      assert.deepEqual(
        validateFavoriteTileUpdate(
          { storeId: STORE_ID, productId: PRODUCT_ID, variantId, isFavorite },
          [STORE_ID],
        ),
        {
          ok: true,
          update: { storeId: STORE_ID, productId: PRODUCT_ID, variantId, isFavorite },
        },
      );
    }
  }
});

test("favorite-tile compatibility strips unknown fields", () => {
  const result = validateFavoriteTileUpdate({
    storeId: STORE_ID,
    productId: PRODUCT_ID,
    variantId: null,
    isFavorite: true,
    ignored: "strip-me",
  }, [STORE_ID]);

  assert.equal(result.ok, true);
  assert.equal("ignored" in result.update, false);
});

test("favorite-tile compatibility rejects malformed IDs and missing fields", () => {
  for (const value of [
    null,
    {},
    { storeId: "invalid", productId: PRODUCT_ID, variantId: null, isFavorite: true },
    { storeId: STORE_ID, productId: "invalid", variantId: null, isFavorite: true },
    { storeId: STORE_ID, productId: PRODUCT_ID, variantId: "invalid", isFavorite: true },
    { storeId: STORE_ID, productId: PRODUCT_ID, variantId: null },
  ]) {
    assert.deepEqual(validateFavoriteTileUpdate(value, [STORE_ID]), {
      ok: false,
      result: { ok: false, message: "Choose a product in one of your assigned stores." },
    });
  }
});

test("favorite-tile compatibility rejects a valid but unassigned store", () => {
  assert.deepEqual(validateFavoriteTileUpdate({
    storeId: STORE_ID,
    productId: PRODUCT_ID,
    variantId: null,
    isFavorite: true,
  }, []), {
    ok: false,
    result: { ok: false, message: "Choose a product in one of your assigned stores." },
  });
});

test("favorite-tile compatibility freezes route permission failure", () => {
  assert.deepEqual(favoriteTilePermissionFailure(), {
    ok: false,
    message: "Product-management permission is required to configure POS tiles.",
  });
});

test("favorite-tile compatibility maps permission, saleability, mismatch, and provider failures", () => {
  for (const [data, error, message] of [
    [null, { code: "42501" }, "You do not have permission to configure tiles for this POS."],
    [null, { code: "22023" }, "Only currently saleable products can be pinned, with up to 24 favorites."],
    [false, null, "TINDIO could not update this POS tile."],
    [null, { code: "XX000" }, "TINDIO could not update this POS tile."],
  ]) {
    assert.deepEqual(mapFavoriteTileRpcResult(data, error, true), {
      ok: false,
      message,
    });
  }
});

test("favorite-tile compatibility maps exact pin and unpin successes", () => {
  assert.deepEqual(mapFavoriteTileRpcResult(true, null, true), {
    ok: true,
    isFavorite: true,
    message: "Product pinned to POS favorites.",
  });
  assert.deepEqual(mapFavoriteTileRpcResult(false, null, false), {
    ok: true,
    isFavorite: false,
    message: "Product removed from POS favorites.",
  });
});
