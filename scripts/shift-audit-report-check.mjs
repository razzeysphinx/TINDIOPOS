import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

const [workspace, manager, detailPage, detailData, migration, historyMigration] = await Promise.all([
  source("src/app/(back-office)/back-office/shifts/page.tsx"),
  source("src/features/shifts/shift-manager.tsx"),
  source("src/app/(back-office)/back-office/shifts/[shiftId]/page.tsx"),
  source("src/features/shifts/data.ts"),
  source("supabase/migrations/20260828082731_shift_audit_report_details.sql"),
  source("supabase/migrations/20260828083939_shift_audit_history_listing.sql"),
]);

assert.match(workspace, /canViewClosedShiftAudit/, "Shift workspace must derive the existing history/settings permission boundary");
assert.match(workspace, /canViewClosedShiftAudit=\{canViewClosedShiftAudit\}/, "Shift workspace must pass the detail access state to the audit trail");
assert.match(workspace, /get_shift_audit_history/, "Audit users must load closed shifts through the history-scoped RPC");
assert.match(workspace, /isOperationsMode\s*\?\s*supabase/, "Report mode must not depend on operational-shift reads");
assert.match(workspace, /requireBackOfficePermission\(\["dashboard\.view", "reports\.view", "shifts\.view_history", "settings\.manage"\]\)/, "Back Office audit users must be able to reach the Shift Reports route");
assert.match(manager, /role=\{canViewClosedShiftAudit \? "link" : undefined\}/, "Authorized closed-shift rows must be keyboard-accessible links");
assert.match(manager, /router\.push\(reportHref\)/, "Authorized closed-shift rows must navigate to their report");
assert.match(manager, /event\.stopPropagation\(\)/, "Print must remain usable without opening the audit report");
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
