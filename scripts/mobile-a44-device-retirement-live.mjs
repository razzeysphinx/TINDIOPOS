import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import { requireCanonicalProductionNeonTarget } from "./lib/canonical-production-neon-target.mjs";
import { runReadOnlySql, runSql } from "./lib/phase-04-postgres-docker.mjs";

const ORGANIZATION_ID = "baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9";
const SHIFT_ID = "d2cd3c24-543c-415f-9d97-a2ca92ff6e4e";
assert.equal(process.env.TINDIO_DATABASE_PROVIDER, "neon", "TINDIO_DATABASE_PROVIDER must be neon.");
const { databaseUrl } = requireCanonicalProductionNeonTarget(process.env.DATABASE_URL_UNPOOLED);

function required(name) {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} is required.`);
  return value;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function authenticateChoices() {
  const choices = [
    ["TINDIO_PHASE_04_TEST_EMAIL", "TINDIO_PHASE_04_TEST_PASSWORD"],
    ["TINDIO_PHASE_05_TEST_EMAIL", "TINDIO_PHASE_05_TEST_PASSWORD"],
  ].filter(([email, password]) => process.env[email]?.trim() && process.env[password]?.trim());
  assert.ok(choices.length > 0, "No certification credentials are configured.");
  const authenticated = [];
  for (const [emailName, passwordName] of choices) {
    const response = await fetch(`${required("NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/u, "")}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), "Content-Type": "application/json" },
      body: JSON.stringify({ email: required(emailName), password: required(passwordName) }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json();
    if (response.status === 200 && typeof body.access_token === "string") authenticated.push({ credential: emailName, token: body.access_token });
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
assert.equal(shift.status, "open", "The synthetic A44 fixture requires the existing certification shift to remain open.");
const pendingFixture = JSON.parse(runReadOnlySql(databaseUrl, `select coalesce((
  select jsonb_build_object('deviceId',device.id,'leaseState',lease.state)
  from public.pos_devices device
  join private.pos_shift_custody_leases lease
    on lease.organization_id=device.organization_id and lease.device_id=device.id
  where device.organization_id='${ORGANIZATION_ID}'::uuid
    and device.name='MOB-10 A44 synthetic lost terminal'
    and device.status='active'
    and lease.state='ACTIVE'
  order by device.created_at desc
  limit 1
), 'null'::jsonb)::text;`));
const deviceId = pendingFixture?.deviceId ?? randomUUID();
const secret = randomBytes(32).toString("hex");
const reason = `MOB-10 A44 synthetic lost-device fixture ${deviceId}`;
const before = financialCounts();
const identities = await authenticateChoices();
let authorized;
if (pendingFixture) {
  for (const identity of identities) {
    const permissionProbe = await rpc(identity.token, "revoke_pos_device", {
      target_organization_id: ORGANIZATION_ID,
      target_device_id: deviceId,
      target_reason: reason,
    });
    if (permissionProbe.body?.code === "23514") { authorized = identity; break; }
    if (permissionProbe.body?.code !== "42501") assert.fail(`Synthetic A44 permission probe failed: ${JSON.stringify(permissionProbe.body)}`);
  }
} else {
  for (const identity of identities) {
    const registration = await rpc(identity.token, "register_pos_device", {
      target_organization_id: ORGANIZATION_ID,
      target_store_id: shift.storeId,
      target_register_id: shift.registerId,
      target_device_id: deviceId,
      target_name: "MOB-10 A44 synthetic lost terminal",
      target_app_version: "a44-certification",
      target_secret: secret,
    });
    if (registration.status === 200) { authorized = identity; break; }
    if (registration.body?.code !== "42501") assert.fail(`Synthetic A44 enrollment failed: ${JSON.stringify(registration.body)}`);
  }
}
assert.ok(authorized, "No configured certification identity has devices.manage.");

if (!pendingFixture) {
  runSql(databaseUrl, `insert into private.pos_shift_custody_leases(
    organization_id,shift_id,device_id,store_id,register_id,state,acquired_at,last_renewed_at
  ) values (
    '${ORGANIZATION_ID}'::uuid,'${SHIFT_ID}'::uuid,'${deviceId}'::uuid,${sqlLiteral(shift.storeId)}::uuid,${sqlLiteral(shift.registerId)}::uuid,'ACTIVE',now(),now()
  );`);
}

const reconciled = await rpc(authorized.token, "retire_pos_device", {
  target_organization_id: ORGANIZATION_ID,
  target_device_id: deviceId,
  target_custody_decision: "RECONCILED",
  target_reason: reason,
  target_loss_confirmation: null,
});
assert.equal(reconciled.body?.code, "23514", JSON.stringify(reconciled.body));
assert.match(reconciled.body?.message ?? "", /active offline shift custody/);

const unconfirmed = await rpc(authorized.token, "retire_pos_device", {
  target_organization_id: ORGANIZATION_ID,
  target_device_id: deviceId,
  target_custody_decision: "DEVICE_UNAVAILABLE_ACCEPT_BOUNDED_LOSS",
  target_reason: reason,
  target_loss_confirmation: "NOT ACCEPTED",
});
assert.equal(unconfirmed.body?.code, "23514", JSON.stringify(unconfirmed.body));
assert.match(unconfirmed.body?.message ?? "", /exact bounded-loss confirmation/);

const retired = await rpc(authorized.token, "retire_pos_device", {
  target_organization_id: ORGANIZATION_ID,
  target_device_id: deviceId,
  target_custody_decision: "DEVICE_UNAVAILABLE_ACCEPT_BOUNDED_LOSS",
  target_reason: reason,
  target_loss_confirmation: "ACCEPT LOCAL-ONLY TRANSACTION LOSS",
});
assert.equal(retired.status, 200, JSON.stringify(retired.body));
assert.equal(retired.body?.[0]?.custody_decision, "DEVICE_UNAVAILABLE_ACCEPT_BOUNDED_LOSS");
assert.equal(retired.body?.[0]?.lost_custody_count, 1);

const afterState = JSON.parse(runReadOnlySql(databaseUrl, `select jsonb_build_object(
  'deviceStatus',(select status from public.pos_devices where organization_id='${ORGANIZATION_ID}'::uuid and id='${deviceId}'::uuid),
  'leaseState',(select state from private.pos_shift_custody_leases where organization_id='${ORGANIZATION_ID}'::uuid and shift_id='${SHIFT_ID}'::uuid and device_id='${deviceId}'::uuid),
  'lossActorRecorded',(select loss_decided_by_employee_id is not null from private.pos_shift_custody_leases where organization_id='${ORGANIZATION_ID}'::uuid and shift_id='${SHIFT_ID}'::uuid and device_id='${deviceId}'::uuid),
  'lossReason',(select loss_reason from private.pos_shift_custody_leases where organization_id='${ORGANIZATION_ID}'::uuid and shift_id='${SHIFT_ID}'::uuid and device_id='${deviceId}'::uuid),
  'audit',(select metadata from public.audit_logs where organization_id='${ORGANIZATION_ID}'::uuid and event_type='DEVICE_RETIRED_WITH_CUSTODY_DECISION' and metadata->>'device_id'='${deviceId}' order by created_at desc limit 1)
)::text;`));
assert.equal(afterState.deviceStatus, "revoked");
assert.equal(afterState.leaseState, "LOST");
assert.equal(afterState.lossActorRecorded, true);
assert.equal(afterState.lossReason, reason);
assert.equal(afterState.audit?.store_hub_financial_backup, false);
assert.deepEqual(financialCounts(), before, "A44 device retirement changed financial or inventory history.");

console.log(JSON.stringify({
  caseId: "A44",
  result: "PASS",
  fixture: { organizationId: ORGANIZATION_ID, shiftId: SHIFT_ID, deviceId, resumed: Boolean(pendingFixture) },
  rejectedReconciledDecision: { code: reconciled.body.code, message: reconciled.body.message },
  rejectedUnconfirmedLoss: { code: unconfirmed.body.code, message: unconfirmed.body.message },
  retired: retired.body[0],
  afterState,
  financialCounts: { before, after: financialCounts() },
}, null, 2));
