import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");
const migration = read("database/migrations/0019_mobile_a45_operational_alerts.sql");
const route = read("src/app/api/pos/v2/sync/telemetry/route.ts");
const reporter = read("apps/mobile/src/features/sync/sync-telemetry-reporter.tsx");
const state = read("apps/mobile/src/features/observability/production-crash-state.ts");
const reconciliation = read("apps/mobile/src/features/observability/android-exit-reconciliation.ts");
const monitor = read("apps/mobile/src/features/observability/production-responsiveness-monitor.tsx");
const center = read("src/features/observability/production-observability-center.tsx");
const androidExitModule = read("apps/mobile/modules/tindio-exit-observer/android/src/main/java/com/tindio/exitobserver/TindioExitObserverModule.kt");
const androidExitBridge = read("apps/mobile/modules/tindio-exit-observer/index.ts");
const certificationScreen = read("apps/mobile/app/(app)/a45-certification.tsx");

test("A45 routes four aggregate incident families without a second telemetry pipeline", () => {
  assert.match(migration, /create table if not exists public\.pos_operational_alerts/);
  for (const type of ["APP_CRASH", "ANR", "API_OUTAGE", "STALE_QUEUE"]) assert.ok(migration.includes(type));
  assert.match(migration, /create or replace function public\.report_pos_device_sync_telemetry/);
  assert.match(migration, /private\.route_pos_operational_alert/);
  assert.match(route, /target_anr_count/);
  assert.match(reporter, /anrCount: crashState\.anrCount/);
});

test("A45 diagnostics are sanitized, tenant scoped, and visible only through manager RPCs", () => {
  assert.match(migration, /alter table public\.pos_operational_alerts enable row level security/);
  assert.match(migration, /revoke all on table public\.pos_operational_alerts/);
  assert.match(migration, /private\.require_device_manager\(target_organization_id\)/);
  assert.match(migration, /alert\.organization_id = target_organization_id/);
  assert.doesNotMatch(migration, /payload_json|snapshot_json|customer_email|card_number|access_token|device_secret|exception_message|stack_trace/i);
  assert.doesNotMatch(migration, /delete\s+from\s+(?:public\.(?:sales|payments|receipts|inventory_movements|offline_sync_events)|private\.pos_shift_custody_leases)/i);
});

test("A45 mobile state records counts and timestamps only", () => {
  for (const marker of ["anrCount", "lastAnrAt", "recordProductionAnr"]) assert.ok(state.includes(marker));
  assert.match(monitor, /AppState\.addEventListener/);
  assert.match(monitor, /UNRESPONSIVE_THRESHOLD_MS/);
  assert.doesNotMatch(`${state}\n${monitor}`, /error\.message|error\.stack|componentStack|payload|receipt|customer|payment|token|secret/i);
});

test("A45 reconciles native Android exits before cloud context and deduplicates across clock changes", () => {
  assert.ok(
    reporter.indexOf("await reconcileAndroidProcessExitHistory()")
      < reporter.indexOf("if (!core) return"),
    "native exit history must be retained locally even while cloud business context is unavailable",
  );
  assert.match(reconciliation, /processedAndroidExitFingerprints/);
  assert.match(reconciliation, /legacyMigration/);
  assert.match(reconciliation, /Math\.max\(/);
  assert.match(reconciliation, /event\.type === "ANR"/);
  assert.match(state, /reconcileAndroidExitEvents\(current, events\)/);
  assert.match(state, /if \(next === current\) return current/);
});

test("A45 physical failure triggers are debug-only and expose aggregate exit metadata only", () => {
  assert.match(androidExitModule, /ApplicationInfo\.FLAG_DEBUGGABLE/);
  assert.match(androidExitModule, /requireCertificationBuild\(\)/);
  assert.match(androidExitModule, /REASON_CRASH_NATIVE/);
  assert.match(androidExitModule, /REASON_ANR/);
  assert.match(androidExitModule, /"type" to type/);
  assert.match(androidExitModule, /"timestampMs" to exit\.timestamp\.toDouble\(\)/);
  assert.doesNotMatch(androidExitModule, /getDescription|getTraceInputStream|stack_trace|payload_json|receipt|customer|payment|access_token|device_secret/i);
  assert.match(androidExitBridge, /catch \{\s*return \[\];\s*\}/s);
  assert.match(certificationScreen, /isA45CertificationTriggerAvailable/);
  assert.match(certificationScreen, /available \? \(/);
});

test("A45 gives every routed alert a named operator, channel, runbook, and acknowledgement", () => {
  assert.match(migration, /assigned_employee_name/);
  assert.match(migration, /Back Office > Production Observability/);
  assert.match(migration, /acknowledge_pos_operational_alert/);
  assert.match(center, /Operator:/);
  assert.match(center, /Escalation:/);
  assert.match(center, /Runbook:/);
  assert.match(center, /Do not clear app data/);
  assert.match(center, /diagnosticSummary/);
  assert.doesNotMatch(center, /JSON\.stringify\(alert\.diagnostic/);
});
