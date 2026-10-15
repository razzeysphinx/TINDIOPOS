import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("MOB-13 replaces raw route names with cashier navigation language", () => {
  const home = read("apps/mobile/app/(app)/index.tsx");
  const navigation = read(
    "apps/mobile/src/features/cashier/cashier-navigation.ts",
  );

  for (const label of [
    "Start selling",
    "Receipts",
    "Customers",
    "Shift and cash drawer",
    "Sync and recovery",
    "Account and support",
  ]) {
    assert.match(navigation, new RegExp(label));
  }

  assert.match(home, /TINDIO POS/);
  assert.match(home, /buildCashierNavigation/);
  assert.match(home, /Checkout/);
  assert.match(home, /Store work/);
  assert.match(home, /Help and recovery/);
  assert.match(home, /accessibilityRole="button"/);
  assert.match(home, /minHeight: 64/);
  assert.doesNotMatch(home, /path\.slice\(1\)/);
  assert.doesNotMatch(home, /Backend V1 connected/);
});

test("MOB-13 support diagnostics require an existing manager permission", () => {
  const navigation = read(
    "apps/mobile/src/features/cashier/cashier-navigation.ts",
  );
  const layout = read("apps/mobile/app/(app)/_layout.tsx");

  for (const permission of ["devices.manage", "settings.manage"]) {
    assert.match(navigation, new RegExp(permission.replace(".", "\\.")));
    assert.match(layout, new RegExp(permission.replace(".", "\\.")));
  }

  for (const path of [
    "/hardware",
    "/offline-payments",
    "/production-readiness",
  ]) {
    assert.match(navigation, new RegExp(path));
    assert.match(layout, new RegExp(path));
  }

  assert.match(navigation, /canUseSupportDiagnostics \? \[/);
  assert.match(layout, /authorizedSupportPaths\.has\(pathname\)/);
  assert.match(layout, /requiresSupportAccess && !hasSupportAccess/);
  assert.match(layout, /<Redirect href="\/\(app\)"/);
});

test("MOB-13 preserves operational recovery and permission-based workflows", () => {
  const home = read("apps/mobile/app/(app)/index.tsx");
  const navigation = read(
    "apps/mobile/src/features/cashier/cashier-navigation.ts",
  );

  assert.match(navigation, /path: "\/sync-status"/);
  assert.match(navigation, /Review saved transactions and reconnect safely/);
  assert.match(home, /cashierReadinessLabel/);
  assert.match(home, /canReleaseTransactionCustody/);

  for (const gate of [
    "receipts",
    "customers",
    "shift",
    "tickets",
    "transfers",
    "timeClock",
  ]) {
    assert.match(navigation, new RegExp(`input\\.gates\\.${gate}`));
  }
});

test("MOB-13 presents a safe, touch-sized business-context recovery state", () => {
  const home = read("apps/mobile/app/(app)/index.tsx");

  assert.match(home, /We couldn’t open this register/);
  assert.match(home, /Saved transactions remain on this device/);
  assert.match(home, /accessibilityRole="alert"/);
  assert.match(home, /accessibilityRole="button"/);
  assert.match(home, /minHeight: 52/);
  assert.match(home, /backgroundColor: "#F4EFE5"/);
  assert.match(home, /onPress=\{\(\) => void reload\(\)\}/);
});
