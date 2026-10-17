import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const pos = read("apps/mobile/app/(app)/pos.tsx");
const frame = read("apps/mobile/src/features/cashier/cashier-pos-frame.tsx");
const catalogue = read("apps/mobile/src/features/cashier/cashier-catalogue.tsx");
const cart = read("apps/mobile/src/features/cashier/cashier-cart-workspace.tsx");

test("native POS exposes the web-aligned closed-shift gate before selling surfaces", () => {
  assert.match(pos, /if \(!shiftMatches\) \{[\s\S]*<CashierShiftGate/);
  assert.ok(pos.indexOf("<CashierShiftGate") < pos.indexOf("<CashierCatalogue"));
  for (const marker of [
    "SHIFT CLOSED",
    "Open a register shift to start selling",
    "Products, barcode scanning, cart actions, and payments stay unavailable",
  ]) assert.match(frame, new RegExp(marker));
  assert.match(frame, /canOpenShift && mode === "online"/);
});

test("native POS presents responsive register, catalogue, and cart chrome", () => {
  assert.match(pos, /<CashierRegisterHeader/);
  assert.match(frame, /viewportClass === "compact-phone" \|\| viewportClass === "standard-phone"/);
  assert.match(frame, /Ticket · \{formatItemCount\(itemCount\)\}/);
  assert.match(catalogue, /Select an item or scan a barcode to add it to this sale/);
  assert.match(catalogue, /No saleable products yet/);
  assert.match(cart, /Current cart/);
  assert.match(cart, /Cart is ready/);
  assert.match(pos, /usesTabletCartPane \? renderTenderPanel\(\) : null/);
  assert.match(pos, /!usesTabletCartPane \? renderTenderPanel\(\) : null/);
});

test("visual convergence leaves protected transaction handlers in the controller", () => {
  for (const marker of [
    "createOfflineCashSale",
    "prepareOnlineCheckoutIntent",
    "checkoutPosV2",
    "saveCurrentTicket",
    "completeOnlineCashSale",
  ]) assert.match(pos, new RegExp(marker));
  for (const source of [frame, catalogue, cart]) {
    assert.doesNotMatch(source, /checkoutPosV2|createOfflineCashSale|prepareOnlineCheckoutIntent|DELETE FROM|DROP TABLE/);
  }
});
