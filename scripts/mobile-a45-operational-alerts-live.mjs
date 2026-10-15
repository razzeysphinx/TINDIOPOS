import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import { requireCanonicalProductionNeonTarget } from "./lib/canonical-production-neon-target.mjs";
import { runReadOnlySql } from "./lib/phase-04-postgres-docker.mjs";

const ORGANIZATION_ID = "baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9";
const SHIFT_ID = "d2cd3c24-543c-415f-9d97-a2ca92ff6e4e";
assert.equal(process.env.TINDIO_DATABASE_PROVIDER, "neon");
const { databaseUrl } = requireCanonicalProductionNeonTarget(process.env.DATABASE_URL_UNPOOLED);

function required(name) {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} is required.`);
  return value;
}

function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'`; }

async function authenticateChoices() {
  const choices = [["TINDIO_PHASE_04_TEST_EMAIL", "TINDIO_PHASE_04_TEST_PASSWORD"], ["TINDIO_PHASE_05_TEST_EMAIL", "TINDIO_PHASE_05_TEST_PASSWORD"]]
    .filter(([email, password]) => process.env[email]?.trim() && process.env[password]?.trim());
  const authenticated = [];
  for (const [emailName, passwordName] of choices) {
    const response = await fetch(`${required("NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/u, "")}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), "Content-Type": "application/json" },
      body: JSON.stringify({ email: required(emailName), password: required(passwordName) }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json();
    if (response.ok && typeof body.access_token === "string") authenticated.push({ emailName, token: body.access_token });
  }
  assert.ok(authenticated.length > 0, "Certification authentication failed.");
  return authenticated;
}

async function rpc(token, name, body) {
  const response = await fetch(`${required("NEON_DATA_API_URL").replace(/\/$/u, "")}/rpc/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); } catch { result = { message: text }; }
  return { status: response.status, body: result };
}

function financialCounts() {
  return JSON.parse(runReadOnlySql(databaseUrl, `select jsonb_build_object(
    'sales',(select count(*) from public.sales where organization_id='${ORGANIZATION_ID}'::uuid),
    'payments',(select count(*) from public.payments where organization_id='${ORGANIZATION_ID}'::uuid),
    'receipts',(select count(*) from public.receipts where organization_id='${ORGANIZATION_ID}'::uuid),
    'inventoryMovements',(select count(*) from public.inventory_movements where organization_id='${ORGANIZATION_ID}'::uuid)
  )::text;`));
}

const shift = JSON.parse(runReadOnlySql(databaseUrl, `select jsonb_build_object('storeId',store_id,'registerId',register_id,'status',status)::text from public.shifts where organization_id='${ORGANIZATION_ID}'::uuid and id='${SHIFT_ID}'::uuid;`));
assert.equal(shift.status, "open");
const pendingFixture = JSON.parse(runReadOnlySql(databaseUrl, `select coalesce((select jsonb_build_object('deviceId',id) from public.pos_devices where organization_id='${ORGANIZATION_ID}'::uuid and name='MOB-10 A45 synthetic incident terminal' and status='active' order by created_at desc limit 1),'null'::jsonb)::text;`));
const deviceId = pendingFixture?.deviceId ?? randomUUID();
const before = financialCounts();
const identities = await authenticateChoices();
let authorized;
if (pendingFixture) {
  for (const identity of identities) {
    const probe = await rpc(identity.token, "list_pos_operational_alerts", { target_organization_id: ORGANIZATION_ID });
    if (probe.status === 200) { authorized = identity; break; }
    if (probe.body?.code !== "42501") assert.fail(JSON.stringify(probe.body));
  }
} else {
  for (const identity of identities) {
    const registration = await rpc(identity.token, "register_pos_device", {
      target_organization_id: ORGANIZATION_ID,
      target_store_id: shift.storeId,
      target_register_id: shift.registerId,
      target_device_id: deviceId,
      target_name: "MOB-10 A45 synthetic incident terminal",
      target_app_version: "a45-certification",
      target_secret: randomBytes(32).toString("hex"),
    });
    if (registration.status === 200) { authorized = identity; break; }
    if (registration.body?.code !== "42501") assert.fail(JSON.stringify(registration.body));
  }
}
assert.ok(authorized, "No certification identity has devices.manage.");
const employee = JSON.parse(runReadOnlySql(databaseUrl, `select jsonb_build_object('id',employee.id,'name',coalesce(nullif(profile.full_name,''),employee.employee_number))::text from public.employees employee join public.profiles profile on profile.id=employee.profile_id where employee.organization_id='${ORGANIZATION_ID}'::uuid and lower(profile.email)=lower(${sqlLiteral(required(authorized.emailName))}) and employee.status='active';`));
const now = new Date();
const old = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
const reportBase = {
  target_organization_id: ORGANIZATION_ID, target_device_id: deviceId, target_store_id: shift.storeId, target_register_id: shift.registerId,
  target_employee_id: employee.id, target_employee_name: employee.name, target_app_version: "a45-certification",
  target_device_checkpoint: 12, target_server_checkpoint: 10, target_conflict_count: 0, target_failed_count: 0,
  target_crash_count: 1, target_crash_window_started_at: old, target_last_crash_at: now.toISOString(),
  target_anr_count: 1, target_last_anr_at: now.toISOString(), target_api_average_latency_ms: 4000, target_api_max_latency_ms: 30000,
  target_sync_average_latency_ms: 1000, target_sync_max_latency_ms: 4000, target_local_database_health: "HEALTHY", target_local_schema_version: 13,
};
const incident = await rpc(authorized.token, "report_pos_device_sync_telemetry", { ...reportBase, target_connection_mode: "DEVICE_ISOLATED", target_last_successful_sync_at: old, target_queue_depth: 8, target_offline_since: old, target_api_failure_count: 3 });
assert.equal(incident.status, 200, JSON.stringify(incident.body));
const listed = await rpc(authorized.token, "list_pos_operational_alerts", { target_organization_id: ORGANIZATION_ID });
assert.equal(listed.status, 200, JSON.stringify(listed.body));
const fixtureAlerts = listed.body.filter((alert) => alert.device_id === deviceId);
assert.deepEqual(new Set(fixtureAlerts.map((alert) => alert.alert_type)), new Set(["APP_CRASH", "ANR", "API_OUTAGE", "STALE_QUEUE"]));
for (const alert of fixtureAlerts) {
  assert.ok(alert.assigned_employee_name?.trim());
  assert.equal(alert.escalation_channel, "Back Office > Production Observability");
  assert.doesNotMatch(JSON.stringify(alert.diagnostic), /payload|receipt|customer|payment|token|secret|exception|stack|email/i);
  if (alert.status === "OPEN") {
    const acknowledged = await rpc(authorized.token, "acknowledge_pos_operational_alert", { target_organization_id: ORGANIZATION_ID, target_alert_id: alert.alert_id });
    assert.equal(acknowledged.status, 200, JSON.stringify(acknowledged.body));
  }
}
const recovery = await rpc(authorized.token, "report_pos_device_sync_telemetry", { ...reportBase, target_connection_mode: "CLOUD_ONLINE", target_last_successful_sync_at: new Date().toISOString(), target_device_checkpoint: 12, target_server_checkpoint: 12, target_queue_depth: 0, target_offline_since: null, target_api_failure_count: 3 });
assert.equal(recovery.status, 200, JSON.stringify(recovery.body));
const retirement = await rpc(authorized.token, "retire_pos_device", { target_organization_id: ORGANIZATION_ID, target_device_id: deviceId, target_custody_decision: "RECONCILED", target_reason: "A45 synthetic incident fixture reconciled", target_loss_confirmation: null });
assert.equal(retirement.status, 200, JSON.stringify(retirement.body));
assert.deepEqual(financialCounts(), before);
const finalAlerts = (await rpc(authorized.token, "list_pos_operational_alerts", { target_organization_id: ORGANIZATION_ID })).body.filter((alert) => alert.device_id === deviceId);
const statusByType = Object.fromEntries(finalAlerts.map((alert) => [alert.alert_type, alert.status]));
assert.equal(statusByType.APP_CRASH, "ACKNOWLEDGED");
assert.equal(statusByType.ANR, "ACKNOWLEDGED");
assert.equal(statusByType.API_OUTAGE, "RESOLVED");
assert.equal(statusByType.STALE_QUEUE, "RESOLVED");

console.log(JSON.stringify({ caseId: "A45", result: "IMPLEMENTATION_RUNTIME_PASS", fixture: { organizationId: ORGANIZATION_ID, deviceId, resumed: Boolean(pendingFixture) }, operator: fixtureAlerts[0]?.assigned_employee_name, escalationChannel: fixtureAlerts[0]?.escalation_channel, injectedAlerts: fixtureAlerts.map((alert) => ({ type: alert.alert_type, diagnostic: alert.diagnostic })), finalStatuses: statusByType, financialCounts: { before, after: financialCounts() }, deviceStatus: retirement.body?.[0]?.status }, null, 2));
