import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("shared catalogue, customer, and reference DTOs retain their wire fields", async () => {
  const contract = await read("packages/contracts/src/pos-data.ts");

  for (const field of [
    "productId",
    "variantId",
    "categoryId",
    "productName",
    "variantName",
    "sku",
    "barcode",
    "priceMinor",
    "allowFractionalQuantity",
    "customerNumber",
    "loyaltyCardCode",
    "loyaltyPoints",
    "paymentMethods",
    "loyaltyProgram",
    "discounts",
    "taxRates",
    "diningOptions",
    "ticketTemplates",
    "referenceVersion",
  ]) {
    assert.match(contract, new RegExp(`\\b${field}\\b`));
  }

  assert.match(contract, /version:\s*2/);
  assert.match(contract, /offlinePolicy:\s*"disabled"\s*\|\s*"cash"\s*\|\s*"manual_external"/);
  assert.doesNotMatch(
    contract,
    /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/,
  );
});

test("delta pull and resnapshot use package-owned concrete DTOs", async () => {
  const sync = await read("packages/contracts/src/sync-control.ts");

  for (const typeName of [
    "PosCatalogDelta",
    "PosCustomerDelta",
    "PosSyncPullResponse",
    "PosSyncResnapshotResponse",
  ]) {
    assert.match(sync, new RegExp(`export type ${typeName}\\b`));
  }
  assert.match(sync, /snapshot:\s*PosReferenceV2Response/);
  assert.match(sync, /clearObservedCustomers:\s*true/);
  assert.match(sync, /invalidateModifiers:\s*true/);
});

test("Web facades and scoped Mobile consumers preserve compatibility", async () => {
  const [posFacade, posTypesFacade, deltaApply, resnapshot, customerScreen] = await Promise.all([
    read("src/contracts/pos.ts"),
    read("src/features/pos/pos-types.ts"),
    read("apps/mobile/src/db/delta-apply.ts"),
    read("apps/mobile/src/db/sync-resnapshot.ts"),
    read("apps/mobile/app/(app)/customers.tsx"),
  ]);

  for (const typeName of [
    "PosCatalogItem",
    "PosCustomer",
    "PosReferenceV2Response",
    "PosSyncPullResponse",
    "PosSyncResnapshotResponse",
  ]) {
    assert.match(posFacade, new RegExp(`\\b${typeName}\\b`));
  }
  assert.match(posTypesFacade, /from ["']@tindio\/contracts["']/);
  assert.doesNotMatch(posTypesFacade, /export type PosCatalogItem\s*=/);
  assert.doesNotMatch(posTypesFacade, /export type PosCustomer\s*=/);

  for (const source of [deltaApply, resnapshot, customerScreen]) {
    assert.match(source, /from ["']@tindio\/contracts["']/);
    assert.doesNotMatch(source, /src\/contracts\/pos/);
  }
});
