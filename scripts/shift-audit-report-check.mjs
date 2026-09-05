import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

const [workspace, manager, navigation, layout, drawerShell, quickViewAction, detailPage, detailData, migration, historyMigration] = await Promise.all([
  source("src/app/(back-office)/back-office/shifts/page.tsx"),
  source("src/features/shifts/shift-manager.tsx"),
  source("src/components/back-office/back-office-navigation.tsx"),
  source("src/app/(back-office)/back-office/layout.tsx"),
  source("src/components/back-office/back-office-detail-drawer.tsx"),
  source("src/features/shifts/quick-view/actions.ts"),
  source("src/app/(back-office)/back-office/shifts/[shiftId]/page.tsx"),
  source("src/features/shifts/data.ts"),
  source("supabase/migrations/20260828082731_shift_audit_report_details.sql"),
  source("supabase/migrations/20260828083939_shift_audit_history_listing.sql"),
]);

assert.match(workspace, /canViewClosedShiftAudit/, "Shift workspace must derive the existing history/settings permission boundary");
assert.match(workspace, /canViewClosedShiftAudit=\{canViewClosedShiftAudit\}/, "Shift workspace must pass the detail access state to the audit trail");
assert.match(workspace, /get_shift_audit_history/, "Audit users must load closed shifts through the history-scoped RPC");
assert.match(workspace, /isOperationsMode\s*\?\s*supabase/, "Report mode must not depend on operational-shift reads");
assert.match(workspace, /requireBackOfficePermission\(\["shifts\.view_history", "settings\.manage"\]\)/, "Only Back Office users with shift-history access may reach the Shift Reports route");
assert.match(navigation, /access\.canViewShiftHistory === true/, "Shift Reports navigation must use its dedicated permission state");
assert.match(layout, /canViewShiftHistory:[\s\S]*?shifts\.view_history[\s\S]*?settings\.manage/, "Layout must derive shift-history navigation access from authoritative permissions");
assert.match(workspace, /<ShiftManager\s+auditFilters=\{!isOperationsMode/, "Report filters must be provided to the Shift Manager rather than rendered as a separate page card");
assert.match(workspace, /<GlobalFilterBar[\s\S]*?embedded/, "Shift reports must reuse the shared filter form in embedded mode");
assert.match(workspace, /showEmbeddedDividers=\{false\}/, "The embedded shift filters must not add duplicate dividers inside the Shift History card");
assert.match(manager, /<ShiftAuditDrawer/, "The audit trail must reuse a shared right-side shift-report drawer");
assert.match(manager, /<ClosedShiftHistory\s+auditFilters=\{auditFilters\}/, "The existing filter form must be placed in the audit-trail workflow");
assert.match(manager, /<CardHeader className="border-b">[\s\S]*?<CardTitle>Shift history<\/CardTitle>/, "Shift history must retain one intentional divider beneath its description");
assert.match(manager, /<CardContent className="space-y-4">\s*\{auditFilters\}/, "Filters must render directly above the closed-shift results");
assert.match(manager, /<BackOfficeDetailDrawer closeLabel="Close shift report" width="compact">/, "The selected report must use the shared Back Office detail drawer");
assert.match(drawerShell, /side="right"/, "The shared detail drawer must open from the right");
assert.match(drawerShell, /"flex h-dvh max-h-none max-w-none flex-col rounded-none"/, "The shared detail drawer must fill the available height without resizing the page");
assert.match(manager, /role=\{canViewClosedShiftAudit \? "button" : undefined\}/, "Authorized closed-shift rows must be keyboard-accessible controls");
assert.match(manager, /onKeyDown=\{\(event\) =>/, "Rows must support keyboard activation");
assert.match(manager, /id=\{`shift-report-open-\$\{shift\.id\}`\}/, "Drawer focus must return to the selected row after close");
assert.match(manager, /loadShiftQuickViewAction\(\{ shiftId \}\)/, "Shift details must load only after the user selects a shift");
assert.doesNotMatch(manager, /router\.push\(reportHref\)/, "The normal audit-table view must not navigate away to inspect a report");
assert.doesNotMatch(manager, /<th[^>]*>Print<\/th>/, "Printing must not occupy a table column");
assert.match(manager, /aria-label="Shift report actions"/, "Printing must be available from the selected report action menu");
assert.match(manager, /Starting cash \+ cash sales − cash refunds \+ paid in − paid out/, "Expected cash must explain the authoritative formula");
assert.match(manager, /Print shift report/, "The selected report action menu must expose printing with a clear label");
assert.match(quickViewAction, /requireBackOfficePermission\(\["shifts\.view_history", "settings\.manage"\]\)/, "Quick view must enforce the existing server-side permission boundary");
assert.match(quickViewAction, /loadShiftAuditReport\(context, parsed\.data\.shiftId\)/, "Quick view must reuse the canonical detail loader");
assert.match(detailPage, /requireBackOfficePermission\(\["shifts\.view_history", "settings\.manage"\]\)/, "Direct report routes must require an existing Back Office permission");
assert.match(detailData, /get_shift_audit_report/, "Report page must use the guarded report RPC");

assert.match(migration, /\(select auth\.uid\(\)\) is null/, "RPC must reject unauthenticated callers");
assert.match(migration, /'shifts\.view_history'/, "RPC must require the existing shift-history permission");
assert.match(migration, /public\.employee_stores/, "Non-settings viewers must be limited to an assigned store");
assert.match(migration, /'audit\.view'/, "Audit-log events must honor the existing audit permission");
assert.match(migration, /public\.payments/, "Payment breakdown must use existing payment records");
assert.match(migration, /public\.cash_movements/, "Cash movements must use the existing ledger");
assert.match(migration, /revoke all on function public\.get_shift_audit_report/, "RPC must use least-privilege execute grants");
assert.doesNotMatch(migration, /create table/i, "Shift Audit Report must not duplicate audit data into a new table");

assert.match(historyMigration, /shift\.status = 'closed'/, "History RPC must return only closed shifts");
assert.match(historyMigration, /'shifts\.view_history'/, "History RPC must require the existing history permission");
assert.match(historyMigration, /public\.employee_stores/, "History RPC must limit non-settings viewers to assigned stores");
assert.match(historyMigration, /revoke all on function public\.get_shift_audit_history/, "History RPC must use least-privilege execute grants");

console.log("Shift Audit Report navigation, data reuse, and security checks passed.");
