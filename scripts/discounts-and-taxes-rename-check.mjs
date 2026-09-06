import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

const [page, navigation, manager, actions] = await Promise.all([
  source("src/app/(back-office)/back-office/advanced-sales/page.tsx"),
  source("src/components/back-office/back-office-navigation.tsx"),
  source("src/features/advanced-sales/advanced-sales-manager.tsx"),
  source("src/features/advanced-sales/actions.ts"),
]);

test("the existing route is presented as Discounts & Taxes in the page and sidebar", () => {
  assert.match(page, /metadata = \{ title: "Discounts & Taxes" \}/);
  assert.match(page, /title="Discounts & Taxes"/);
  assert.match(page, /Configure the discounts and tax rates used during sales/);
  assert.match(navigation, /href: "\/back-office\/advanced-sales",\s*label: "Discounts & Taxes"/);
});

test("discount and tax behavior remains on the same canonical configuration route", () => {
  assert.match(manager, /<DiscountSettings discounts=\{discounts\}/);
  assert.match(manager, /<TaxSettings taxRates=\{taxRates\}/);
  assert.match(actions, /revalidatePath\("\/back-office\/advanced-sales"\)/);
});

test("real optional selling features are retained and clearly separated", () => {
  assert.match(manager, /Related selling configuration/);
  assert.match(manager, /features\.dining/);
  assert.match(manager, /features\.open_tickets/);
  assert.match(manager, /features\.modifiers/);
});
