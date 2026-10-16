import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Slice 10 provides a phone cart summary and persistent tablet cart pane", () => {
  const pos = read("apps/mobile/app/(app)/pos.tsx");
  const workspace = read("apps/mobile/src/features/cashier/cashier-cart-workspace.tsx");
  const responsive = read("apps/mobile/src/ui/tindio-responsive.ts");
  assert.match(pos, /usesTabletCartPane = allowsColumns && viewportClass === "tablet"/);
  assert.match(responsive, /compactTabletMax: 899/);
  assert.match(pos, /compact=\{!usesTabletCartPane\}/);
  assert.match(pos, /expanded=\{usesTabletCartPane \|\| cartExpanded\}/);
  assert.match(pos, /saleWorkspaceTablet/);
  assert.match(workspace, /View cart \(\$\{cart\.length\}\)/);
  assert.match(workspace, /accessibilityState=\{\{ expanded \}\}/);
});

test("Slice 10 preserves cart identity, mutation, calculation, and configuration authority", () => {
  const pos = read("apps/mobile/app/(app)/pos.tsx");
  const line = read("apps/mobile/src/features/cashier/cashier-cart-line.tsx");
  const editors = read("apps/mobile/src/features/cashier/cashier-editors.tsx");
  for (const marker of [
    "posItemKey",
    "calculateLocalCartTotals",
    "setLineQuantity",
    "setLineNote",
    "removeLine",
    "startConfigure",
    "markCartChanged",
    "offlineCashCartRestriction",
  ]) assert.match(pos, new RegExp(marker));
  assert.match(line, /localCartLineTotalMinor\(line\)/);
  assert.match(line, /normalizeQuantity\(quantity, line\.allowFractionalQuantity\)/);
  assert.match(line, /Edit price or options/);
  assert.match(line, /Notes require a connection at checkout/);
  assert.match(editors, /parseMoneyToMinor\(value\)/);
  assert.match(editors, /group\.minSelections/);
  assert.match(editors, /group\.maxSelections/);
  assert.match(editors, /accessibilityRole="checkbox"/);
  assert.match(editors, /Apply options/);
});

test("Slice 10 presents totals, sale details, customer boundaries, and accessible controls", () => {
  const workspace = read("apps/mobile/src/features/cashier/cashier-cart-workspace.tsx");
  for (const label of ["Subtotal", "Discount", "Tax", "Total", "Dining option", "Customer"]) {
    assert.match(workspace, new RegExp(label));
  }
  assert.match(workspace, /accessibilityRole="radiogroup"/);
  assert.match(workspace, /accessibilityRole="radio"/);
  assert.match(workspace, /accessibilityState=\{\{ checked: selected \}\}/);
  assert.match(workspace, /Only customers saved on this device can be found offline/);
  assert.match(workspace, /minHeight: tindioTheme\.target\.minimum/);
});

test("Slice 10 keeps stock estimates honest and exposes unsupported offline-cart restrictions", () => {
  const pos = read("apps/mobile/app/(app)/pos.tsx");
  const workspace = read("apps/mobile/src/features/cashier/cashier-cart-workspace.tsx");
  assert.match(pos, /readCartOfflineInventoryIntelligence/);
  assert.match(pos, /offlineCashCartRestrictionMessage\(offlineCartRestriction\)/);
  assert.match(workspace, /Estimated stock \(may change after sync\)/);
  assert.match(workspace, /not authoritative cloud stock/);
  assert.match(workspace, /Current device only\. Other offline terminals are not represented here\./);
  assert.match(workspace, /This device estimate projects stock below zero/);
  assert.match(workspace, /testID="offline-cart-restriction"/);
  assert.doesNotMatch(workspace, /LOCAL PREVIEW ONLY|INVENTORY INTELLIGENCE|STORE_LOCAL_AWARE/);
});

test("Slice 10 does not move tender or checkout authority into presentation components", () => {
  const workspace = read("apps/mobile/src/features/cashier/cashier-cart-workspace.tsx");
  const line = read("apps/mobile/src/features/cashier/cashier-cart-line.tsx");
  assert.doesNotMatch(workspace + line, /checkoutPosV2|createOfflineCashSale|prepareOnlineCheckoutIntent|syncOutboxEvents|cashTender|paymentMethodId/);
});
