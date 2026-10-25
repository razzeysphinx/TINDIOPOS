import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("H3 observes provider, application, data, mobile, finance, and support surfaces", async () => {
  const plan = JSON.parse(await read("docs/architecture/TINDIO_PHASE_H3_MONITORING_SUPPORT.json"));
  assert.deepEqual(plan.monitoringSources, [
    "web_and_backend_structured_logs",
    "auth_provider_events_and_dashboard",
    "postgres_and_data_api_metrics",
    "mobile_api_sync_and_crash_telemetry",
    "financial_reconciliation_queries",
    "support_incident_queue",
  ]);
  assert.deepEqual(plan.requiredDashboardWindows, ["15m", "1h", "24h", "72h"]);
});

test("H3 assigns zero tolerance to security, identity, financial, and custody corruption", async () => {
  const plan = JSON.parse(await read("docs/architecture/TINDIO_PHASE_H3_MONITORING_SUPPORT.json"));
  const sev1 = plan.rollbackTriggers.filter(({ severity }) => severity === "SEV1");
  assert.deepEqual(sev1.map(({ id }) => id), [
    "security_authorization_escape",
    "cross_tenant_or_store_access",
    "duplicate_financial_effects",
    "lost_or_corrupted_offline_custody",
    "unmapped_or_wrongly_mapped_identity",
  ]);
  assert.equal(sev1.every(({ operator, value }) => operator === ">" && value === 0), true);
});

test("H3 numerical thresholds remain unapproved and fail closed", async () => {
  const [planSource, document, packageSource] = await Promise.all([
    read("docs/architecture/TINDIO_PHASE_H3_MONITORING_SUPPORT.json"),
    read("docs/architecture/TINDIO_PHASE_H3_MONITORING_SUPPORT.md"),
    read("package.json"),
  ]);
  const plan = JSON.parse(planSource);
  assert.equal(plan.thresholdsRequireOwnerRatification, true);
  assert.equal(plan.runbookApproved, false);
  assert.equal(plan.productionChangesMade, false);
  assert.equal(plan.decision, "NO_GO");
  assert.equal(plan.secretAndPrivacyRule, "NO_TOKENS_COOKIES_PASSWORDS_OR_RAW_PERSONAL_DATA");
  assert.match(document, /A resolved user symptom is not sufficient/);
  assert.equal(JSON.parse(packageSource).scripts["test:architecture-phase-h3-monitoring-support"], "node --test scripts/architecture-phase-h3-monitoring-support-check.mjs");
});
