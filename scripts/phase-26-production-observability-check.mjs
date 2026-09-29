import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Phase 26 telemetry covers locked operational health signals", () => {
  const migration = read("supabase/migrations/20260929230000_phase_26_production_observability.sql");
  const reporter = read("apps/mobile/src/features/sync/sync-telemetry-reporter.tsx");
  const center = read("src/features/observability/production-observability-center.tsx");
  for (const marker of ["crash_count", "api_average_latency_ms", "sync_average_latency_ms", "queue_depth", "failed_count", "conflict_count", "app_version", "offline_since", "last_heartbeat_at", "local_database_health"]) assert.ok(migration.includes(marker), `migration must include ${marker}`);
  for (const marker of ["getPerformanceMetrics", "getLocalDatabaseHealth", "readProductionCrashState"]) assert.ok(reporter.includes(marker), `reporter must include ${marker}`);
  for (const marker of ["Crash rate", "API avg / max", "Sync avg / max", "Pending queue", "Sync failures", "Conflicts", "Offline duration", "Heartbeat age", "Local database", "ATTENTION REQUIRED"]) assert.ok(center.includes(marker), `observability center must display ${marker}`);
});

test("Phase 26 crash storage is aggregate-only", () => {
  const crashState = read("apps/mobile/src/features/observability/production-crash-state.ts");
  assert.ok(crashState.includes("count") && crashState.includes("windowStartedAt") && crashState.includes("lastCrashAt"));
  assert.doesNotMatch(crashState, /stack|payload|receipt|customer|payment|token|secret/i, "crash state must not persist sensitive diagnostic content");
});

test("Phase 26 root error boundary does not leak exception content", () => {
  const boundary = read("apps/mobile/src/features/runtime/production-error-boundary.tsx");
  assert.ok(boundary.includes("recordProductionCrash"));
  assert.doesNotMatch(boundary, /error\.message|error\.stack|_info\.componentStack/, "root crash reporting must not expose exception content");
});

test("Phase 26 telemetry API remains tenant, employee, and device validated", () => {
  const route = read("src/app/api/pos/v2/sync/telemetry/route.ts");
  assert.ok(route.includes("getPosV2BusinessContext") && route.includes("validatedSyncDevice"));
  assert.ok(route.includes("parsed.data.organizationId") && route.includes("resolved.context.organization.id"));
  assert.ok(route.includes("parsed.data.employeeId") && route.includes("resolved.context.employee.id"));
});

test("Phase 26 Back Office observability is devices.manage guarded", () => {
  const page = read("src/app/(back-office)/back-office/observability/page.tsx");
  const navigation = read("src/components/back-office/back-office-navigation.tsx");
  assert.ok(page.includes("devices.manage"));
  assert.ok(navigation.includes('"/back-office/observability"') && navigation.includes("Production Observability"));
});

test("Phase 26 telemetry does not add transaction payload columns", () => {
  assert.doesNotMatch(read("supabase/migrations/20260929230000_phase_26_production_observability.sql"), /payload_json|snapshot_json|customer_id|customer_email|card_number|\bpan\b|\bcvv\b|\bcvc\b|access_token|device_secret/i, "observability schema must remain aggregate-only");
});
