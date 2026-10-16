import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => fs.readFileSync(path, "utf8");

async function loadTypeScriptModule(file) {
  const output = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const validation = await loadTypeScriptModule(
  "apps/mobile/src/features/cashier/cashier-validation.ts",
);

const baseLine = {
  productId: "product-a",
  variantId: null,
  productName: "A36 synthetic item",
  variantName: null,
  sku: "A36",
  barcode: "A36",
  unit: "each",
  quantity: 1,
  priceMinor: 100,
  isVariablePrice: false,
  allowFractionalQuantity: false,
  manualPriceMinor: null,
  modifierOptionIds: [],
  modifiers: [],
  itemNote: null,
};
const noContext = { customerId: null, diningOptionId: null, openTicketId: null };

test("A36 supported cached cart remains eligible for durable offline cash", () => {
  assert.equal(validation.offlineCashCartRestriction([baseLine], noContext), null);
  assert.equal(validation.cartSupportsDurableOfflineCash([baseLine], noContext), true);
});

for (const scenario of [
  ["customer", [baseLine], { ...noContext, customerId: "customer-a" }, "CUSTOMER_REQUIRES_CONNECTIVITY"],
  ["open ticket", [baseLine], { ...noContext, openTicketId: "ticket-a" }, "OPEN_TICKET_REQUIRES_CONNECTIVITY"],
  ["dining option", [baseLine], { ...noContext, diningOptionId: "dining-a" }, "DINING_REQUIRES_CONNECTIVITY"],
  ["variable price", [{ ...baseLine, isVariablePrice: true, manualPriceMinor: 125 }], noContext, "VARIABLE_PRICE_REQUIRES_CONNECTIVITY"],
  ["modifier ids", [{ ...baseLine, modifierOptionIds: ["modifier-a"] }], noContext, "MODIFIERS_REQUIRE_CONNECTIVITY"],
  ["modifier snapshots", [{ ...baseLine, modifiers: [{ id: "modifier-a" }] }], noContext, "MODIFIERS_REQUIRE_CONNECTIVITY"],
  ["item note", [{ ...baseLine, itemNote: "unsupported offline note" }], noContext, "ITEM_NOTE_REQUIRES_CONNECTIVITY"],
  ["invalid quantity", [{ ...baseLine, quantity: 0 }], noContext, "INVALID_QUANTITY"],
]) {
  test(`A36 ${scenario[0]} is rejected before offline payment`, () => {
    const [, cart, context, expected] = scenario;
    assert.equal(validation.offlineCashCartRestriction(cart, context), expected);
    assert.equal(validation.cartSupportsDurableOfflineCash(cart, context), false);
    assert.match(
      validation.offlineCashCartRestrictionMessage(expected),
      /before collecting (offline cash )?payment|quantity/,
    );
  });
}

test("A36 POS exposes the reason and retains its defensive acceptance boundary", () => {
  const pos = read("apps/mobile/app/(app)/pos.tsx");
  const cart = read("apps/mobile/src/features/cashier/cashier-cart-workspace.tsx");
  const acceptance = read("apps/mobile/src/features/outbox/create-offline-sale.ts");
  assert.match(cart, /testID="offline-cart-restriction"/);
  assert.match(pos, /offlineCashCartRestrictionMessage\(offlineCartRestriction\)/);
  assert.ok(
    pos.indexOf("if (offlineCartRestriction)") < pos.indexOf("await createOfflineCashSale"),
    "unsupported cart must be rejected before durable acceptance",
  );
  assert.ok(
    acceptance.indexOf('reason: "UNSUPPORTED_OFFLINE_CART"')
      < acceptance.indexOf("Crypto.randomUUID()"),
    "defensive acceptance must reject unsupported lines before allocating transaction identity",
  );
  assert.match(
    acceptance,
    /!\(line\.itemNote \?\? ""\)\.trim\(\)/,
    "defensive acceptance must reject item-note state even if the UI boundary is bypassed",
  );
});

test("A36 offline ticket and electronic payment paths remain fail closed", () => {
  const pos = read("apps/mobile/app/(app)/pos.tsx");
  const tickets = read("apps/mobile/app/(app)/tickets.tsx");
  const payments = read("apps/mobile/app/(app)/offline-payments.tsx");
  const risk = read("apps/mobile/src/features/payments/offline-payment-risk.ts");
  assert.match(pos, /disabled=\{mode !== "online"\}/);
  assert.match(tickets, /ONLINE ONLY/);
  assert.match(payments, /NO COMPLIANT PSP STORE-AND-FORWARD ADAPTER/);
  assert.match(payments, /never stores raw card credentials/);
  assert.match(risk, /electronicOfflineAllowed: false/);
});
