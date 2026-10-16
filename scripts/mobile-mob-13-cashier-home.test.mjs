import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("MOB-13 replaces raw route names with responsive cashier task cards", () => {
  const home = read("apps/mobile/app/(app)/index.tsx");
  const navigation = read("apps/mobile/src/features/cashier/cashier-navigation.ts");
  const taskCard = read("apps/mobile/src/features/cashier/cashier-task-card.tsx");
  const responsive = read("apps/mobile/src/ui/tindio-responsive.ts");
  for (const label of ["Start selling", "Receipts", "Customers", "Shift and cash drawer", "Sync and recovery", "Account and support"]) assert.match(navigation, new RegExp(label));
  for (const section of ["Checkout", "Store work", "Help and recovery"]) assert.match(home, new RegExp(section));
  assert.match(home, /CashierTaskCard/);
  assert.match(home, /useTindioResponsiveLayout/);
  assert.match(responsive, /allowsColumns: width >= 720 && !isLargeText/);
  assert.match(home, /cashier-home-scroll/);
  assert.match(home, /allowsDenseGrid \? styles\.taskCardTablet : styles\.taskCardPhone/);
  assert.match(home, /taskCardPhone: \{ width: "100%" \}/);
  assert.match(taskCard, /accessibilityRole="button"/);
  assert.match(taskCard, /minHeight: 88/);
  assert.doesNotMatch(home, /path\.slice\(1\)|Backend V1 connected/);
});

test("MOB-13 support diagnostics require an existing manager permission", () => {
  const navigation = read("apps/mobile/src/features/cashier/cashier-navigation.ts");
  const layout = read("apps/mobile/app/(app)/_layout.tsx");
  for (const permission of ["devices.manage", "settings.manage"]) {
    assert.match(navigation, new RegExp(permission.replace(".", "\\.")));
    assert.match(layout, new RegExp(permission.replace(".", "\\.")));
  }
  for (const path of ["/hardware", "/offline-payments", "/production-readiness"]) {
    assert.match(navigation, new RegExp(path));
    assert.match(layout, new RegExp(path));
  }
  assert.match(navigation, /canUseSupportDiagnostics \? \[/);
  assert.match(layout, /authorizedSupportPaths\.has\(pathname\)/);
  assert.match(layout, /requiresSupportAccess && !hasSupportAccess/);
  assert.match(layout, /<Redirect href="\/\(app\)"/);
});

test("MOB-13 preserves operational recovery, custody, and permission workflows", () => {
  const home = read("apps/mobile/app/(app)/index.tsx");
  const navigation = read("apps/mobile/src/features/cashier/cashier-navigation.ts");
  assert.match(navigation, /path: "\/sync-status"/);
  assert.match(navigation, /Review saved transactions and reconnect safely/);
  assert.match(home, /CashierReadinessPanel/);
  assert.match(home, /canReleaseTransactionCustody/);
  for (const gate of ["receipts", "customers", "shift", "tickets", "transfers", "timeClock"]) assert.match(navigation, new RegExp(`input\\.gates\\.${gate}`));
});

test("MOB-13 presents safe business-context recovery with shared primitives", () => {
  const home = read("apps/mobile/app/(app)/index.tsx");
  const feedback = read("apps/mobile/src/ui/tindio-feedback.tsx");
  const button = read("apps/mobile/src/ui/tindio-button.tsx");
  assert.match(home, /We couldn’t open this register/);
  assert.match(home, /Saved transactions remain on this device/);
  assert.match(home, /TindioScreen/);
  assert.match(home, /onPress=\{\(\) => void reload\(\)\}/);
  assert.match(feedback, /accessibilityRole=\{isAlert \? "alert" : undefined\}/);
  assert.match(button, /accessibilityRole="button"/);
  assert.match(button, /minHeight: tindioTheme\.target\.minimum/);
});

test("MOB-13 keeps readiness states distinct and cashier-facing", () => {
  const panel = read("apps/mobile/src/features/cashier/cashier-readiness-panel.tsx");
  const header = read("apps/mobile/src/features/cashier/cashier-terminal-header.tsx");
  for (const state of ["READY_OFFLINE", "EXPIRING_SOON", "EXPIRED_RECONNECT_REQUIRED", "PREPARATION_REQUIRED", "RECOVERING", "SYNC_REVIEW"]) {
    assert.match(panel, new RegExp(state));
    assert.match(header, new RegExp(state));
  }
  assert.match(panel, /Nothing is deleted or hidden/);
  assert.doesNotMatch(panel, /SQLite|cursor|checkpoint|idempotency/i);
});
