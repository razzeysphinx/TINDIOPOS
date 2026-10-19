import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("shared modifier and cart-line contracts retain their value fields", async () => {
  const contract = await read("packages/contracts/src/cart.ts");

  for (const field of [
    "id",
    "name",
    "priceMinor",
    "minSelections",
    "maxSelections",
    "options",
    "quantity",
    "manualPriceMinor",
    "modifierOptionIds",
    "ticketLineId",
    "itemNote",
    "modifiers",
  ]) {
    assert.match(contract, new RegExp(`\\b${field}\\b`));
  }

  assert.match(contract, /version:\s*2/);
  assert.match(contract, /PosCartLine\s*=\s*PosCatalogItem\s*&/);
  assert.match(contract, /modifiers\?:\s*PosModifierOption\[\]/);
  assert.doesNotMatch(
    contract,
    /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/,
  );
});

test("Web cart facades preserve their existing import paths and key behavior", async () => {
  const [posFacade, posTypesFacade] = await Promise.all([
    read("src/contracts/pos.ts"),
    read("src/features/pos/pos-types.ts"),
  ]);

  for (const typeName of [
    "PosCartLine",
    "PosModifierGroup",
    "PosModifierOption",
    "PosModifierResponse",
    "PosModifiersV2Response",
  ]) {
    assert.match(posFacade, new RegExp(`\\b${typeName}\\b`));
    assert.doesNotMatch(posFacade, new RegExp(`export type ${typeName}\\s*=`));
  }
  assert.match(posTypesFacade, /PosCartLine/);
  assert.match(posTypesFacade, /export \{ posItemKey \} from ["']@tindio\/contracts\/cart["']/);
  assert.doesNotMatch(posTypesFacade, /function posItemKey/);
  assert.match(posTypesFacade, /from ["']@tindio\/contracts["']/);
});

test("Mobile cart, pricing, modifier cache, and outbox consumers use the package", async () => {
  const sources = await Promise.all([
    read("apps/mobile/src/db/modifier-cache.ts"),
    read("apps/mobile/src/features/cashier/cashier-validation.ts"),
    read("apps/mobile/src/features/local-first/local-cart.ts"),
    read("apps/mobile/src/features/outbox/create-offline-sale.ts"),
  ]);

  for (const source of sources) {
    assert.match(source, /from ["']@tindio\/contracts["']/);
    assert.doesNotMatch(source, /src\/contracts\/pos|src\/features\/pos\/pos-types/);
  }
});
