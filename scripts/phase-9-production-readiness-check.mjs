import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [
  backOfficeLayout,
  backOfficeNavigation,
  posTerminal,
  paymentScreen,
  offlineStatus,
  publicEnvironment,
  gitignore,
  workspaceAccessCheck,
  securityBoundaryCheck,
  offlineIntegrityCheck,
  recoveryMigration,
  recoveryDatabaseTest,
] = await Promise.all([
  source("../src/app/(back-office)/back-office/layout.tsx"),
  source("../src/components/back-office/back-office-navigation.tsx"),
  source("../src/features/pos/pos-terminal.tsx"),
  source("../src/features/checkout/payment-screen.tsx"),
  source("../src/features/offline/offline-queue-status.tsx"),
  source("../src/lib/supabase/env.ts"),
  source("../.gitignore"),
  source("./phase-1-workspace-access-check.mjs"),
  source("./phase-7-security-boundary-check.mjs"),
  source("./phase-8-offline-integrity-check.mjs"),
  source("../supabase/migrations/20260825034204_improvement_17_backup_recovery_governance.sql"),
  source("../supabase/tests/database/improvement_17_backup_recovery_governance.test.sql"),
]);

test("Back Office retains the responsive, permission-aware navigation boundary", () => {
  assert.match(backOfficeLayout, /requireBackOfficeContext\(\)/);
  assert.match(backOfficeLayout, /lg:sticky lg:top-0/);
  assert.match(backOfficeLayout, /const canUsePos = context\.permissions\.includes\("sales\.create"\)/);
  assert.match(backOfficeNavigation, /isVisible: \(access: BackOfficeNavigationAccess\) => boolean/);
  assert.match(backOfficeNavigation, /<details/);
  assert.match(backOfficeNavigation, /group\.items\.filter\(\(item\) => !item\.isVisible \|\| item\.isVisible\(access\)\)/);
  assert.match(workspaceAccessCheck, /Cashier deep links named in the Phase 1 audit have server permission gates/);
});

test("POS retains the production-critical operating flow", () => {
  assert.match(posTerminal, /function PosShiftGate\(/);
  assert.match(posTerminal, /OfflineQueueStatus/);
  assert.match(posTerminal, /PosCustomerPicker/);
  assert.match(posTerminal, /PaymentScreen/);
  assert.match(posTerminal, /createCheckoutKey\(\)/);
  assert.match(posTerminal, /"favorites" \| "recent"/);
  assert.match(posTerminal, /Manage tickets/);
  assert.match(paymentScreen, /window\.print\(\)/);
  assert.match(paymentScreen, /offlinePolicy === "cash"/);
  assert.match(offlineStatus, /Sync now/);
  assert.match(offlineStatus, /Retry after resolving/);
});

test("security, tenant isolation, and offline replay safeguards remain covered", () => {
  assert.match(securityBoundaryCheck, /requires an authenticated workspace/);
  assert.match(securityBoundaryCheck, /cross-organization inserts are rejected/);
  assert.match(securityBoundaryCheck, /a revoked device credential is rejected/);
  assert.match(offlineIntegrityCheck, /exactly-once replay/);
  assert.match(offlineIntegrityCheck, /mismatched telemetry bindings/);
  assert.match(offlineIntegrityCheck, /set search_path = ''/);
});

test("public runtime configuration exposes only client-safe Supabase settings", () => {
  assert.match(publicEnvironment, /NEXT_PUBLIC_SUPABASE_URL/);
  assert.match(publicEnvironment, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(publicEnvironment, /SERVICE_ROLE|SUPABASE_SERVICE/i);
  assert.match(gitignore, /^\.env\*$/m);
  assert.match(gitignore, /^!\.env\.example$/m);
});

test("backup and recovery governance remains non-destructive and owner-authorized", () => {
  assert.match(recoveryMigration, /authoritative database backup operation outside the product/i);
  assert.match(recoveryMigration, /Only an owner can record a recovery drill/);
  assert.match(recoveryMigration, /Immutable, owner-authorized evidence/);
  assert.match(recoveryDatabaseTest, /owner can record a manually completed local recovery drill/);
});
