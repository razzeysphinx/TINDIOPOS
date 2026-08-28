import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

const [drawer, header, terminal, receiptMigration, shiftMigration, receiptPage, receiptDetail, itemsPage, settingsPage] = await Promise.all([
  source("src/features/pos/pos-operational-drawer.tsx"),
  source("src/features/pos/pos-workspace-header.tsx"),
  source("src/features/pos/pos-terminal.tsx"),
  source("supabase/migrations/20260828065824_pos_workspace_receipt_access.sql"),
  source("supabase/migrations/20260828070815_pos_shift_summary_print.sql"),
  source("src/app/(pos)/pos/receipts/page.tsx"),
  source("src/app/(pos)/pos/receipts/[receiptId]/page.tsx"),
  source("src/app/(pos)/pos/items/page.tsx"),
  source("src/app/(pos)/pos/settings/page.tsx"),
]);

for (const [label, href] of [["Sales", "/pos"], ["Receipts", "/pos/receipts"], ["Shift", "/pos/shifts"], ["Items", "/pos/items"], ["Settings", "/pos/settings"]]) {
  assert.match(drawer, new RegExp(`label: "${label}"`), `${label} must be part of the shared POS navigation`);
  assert.match(drawer, new RegExp(`href: "${href.replaceAll("/", "\\/")}"`), `${label} must have its POS route`);
}

assert.match(header, /OfflineQueueStatus/, "POS header must expose automatic sync state");
assert.match(header, /onSelectCustomer/, "POS header must support the customer/loyalty action");
assert.match(header, /Close shift/, "POS utility menu must retain close-shift access");
assert.match(terminal, /PosWorkspaceHeader/, "Sales must use the shared POS header");
assert.match(terminal, /if \(!isOperational\)/, "The no-active-shift POS gate must remain in place");
assert.match(terminal, /readPosWorkspacePreferences/, "Sales must consume the POS item-layout preference");

assert.match(receiptPage, /hasPermission\(context, "sales\.create"\)/, "POS receipt history must reject non-POS users");
assert.match(receiptDetail, /hasPermission\(context, "sales\.refund"\)/, "POS refunds must still require the refund permission");
assert.match(itemsPage, /hasPermission\(context, "sales\.create"\)/, "POS items must reject non-POS users");
assert.match(settingsPage, /hasPermission\(context, "sales\.create"\)/, "POS settings must reject non-POS users");

assert.match(receiptMigration, /private\.current_employee_id/, "Receipt RPCs must bind access to an active employee");
assert.match(receiptMigration, /public\.employee_stores/, "Receipt RPCs must bind access to an assigned store");
assert.match(receiptMigration, /sales\.refund/, "Cross-cashier receipt access must be limited to refund-capable roles");
assert.match(receiptMigration, /revoke all on function public\.get_pos_receipt_history/, "Receipt RPC must use least-privilege grants");
assert.doesNotMatch(receiptMigration, /create policy/i, "Receipt projection must not replace existing RLS policies");

assert.match(shiftMigration, /private\.calculate_shift_cash/, "Shift print data must be server-derived");
assert.match(shiftMigration, /show_expected_before_close/, "Shift summary must preserve blind-cash behavior");
assert.match(shiftMigration, /public\.sales/, "Shift summary must include authoritative sales records");
assert.match(shiftMigration, /public\.refunds/, "Shift summary must include authoritative refund records");

console.log("POS workspace navigation and security checks passed.");
