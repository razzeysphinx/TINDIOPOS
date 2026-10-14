import assert from "node:assert/strict";

import { requireCanonicalProductionNeonTarget } from "./lib/canonical-production-neon-target.mjs";
import { runReadOnlySql } from "./lib/phase-04-postgres-docker.mjs";

const ORGANIZATION_ID = "baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9";
const SHIFT_ID = "d2cd3c24-543c-415f-9d97-a2ca92ff6e4e";
const DEVICE_ID = "72c8267d-1aaf-4bc0-91f9-86d6eea47797";

const action = process.argv[2] ?? "status";
assert.ok(["status", "guard"].includes(action), "Expected status or guard.");
assert.equal(process.env.TINDIO_DATABASE_PROVIDER, "neon", "TINDIO_DATABASE_PROVIDER must be neon.");
const { databaseUrl } = requireCanonicalProductionNeonTarget(process.env.DATABASE_URL_UNPOOLED);

function required(name) {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} is required.`);
  return value;
}

function readSnapshot() {
  const sql = `select jsonb_build_object(
    'device',(select jsonb_build_object(
      'id',device.id,'storeId',device.store_id,'registerId',device.register_id,
      'status',device.status,'revokedAt',device.revoked_at,'lastSeenAt',device.last_seen_at
    ) from public.pos_devices device
      where device.organization_id='${ORGANIZATION_ID}'::uuid and device.id='${DEVICE_ID}'::uuid),
    'shift',(select jsonb_build_object(
      'id',shift.id,'storeId',shift.store_id,'registerId',shift.register_id,
      'status',shift.status,'closedByEmployeeId',shift.closed_by_employee_id,
      'expectedCashMinor',shift.expected_cash_minor,'countedCashMinor',shift.counted_cash_minor,
      'differenceMinor',shift.difference_minor,'closingNote',shift.closing_note,'closedAt',shift.closed_at
    ) from public.shifts shift
      where shift.organization_id='${ORGANIZATION_ID}'::uuid and shift.id='${SHIFT_ID}'::uuid),
    'lease',(select jsonb_build_object(
      'organizationId',lease.organization_id,'shiftId',lease.shift_id,'deviceId',lease.device_id,
      'storeId',lease.store_id,'registerId',lease.register_id,'state',lease.state,
      'acquiredAt',lease.acquired_at,'lastRenewedAt',lease.last_renewed_at,
      'clearedAt',lease.cleared_at,'clearedServerSequence',lease.cleared_server_sequence,
      'finalizationToken',lease.finalization_token
    ) from private.pos_shift_custody_leases lease
      where lease.organization_id='${ORGANIZATION_ID}'::uuid
        and lease.shift_id='${SHIFT_ID}'::uuid and lease.device_id='${DEVICE_ID}'::uuid),
    'checkpoint',(select jsonb_build_object('serverCheckpoint',checkpoint.server_checkpoint,'updatedAt',checkpoint.updated_at)
      from public.pos_device_sync_checkpoints checkpoint
      where checkpoint.organization_id='${ORGANIZATION_ID}'::uuid and checkpoint.device_id='${DEVICE_ID}'::uuid),
    'alternateRegister',(select jsonb_build_object('id',register.id,'storeId',register.store_id,'name',register.name)
      from public.registers register join public.stores store
        on store.organization_id=register.organization_id and store.id=register.store_id
      where register.organization_id='${ORGANIZATION_ID}'::uuid and register.is_active and store.is_active
        and register.id<>(select device.register_id from public.pos_devices device
          where device.organization_id='${ORGANIZATION_ID}'::uuid and device.id='${DEVICE_ID}'::uuid)
      order by register.created_at limit 1),
    'financialCounts',jsonb_build_object(
      'sales',(select count(*) from public.sales where organization_id='${ORGANIZATION_ID}'::uuid),
      'payments',(select count(*) from public.payments where organization_id='${ORGANIZATION_ID}'::uuid),
      'receipts',(select count(*) from public.receipts where organization_id='${ORGANIZATION_ID}'::uuid),
      'saleItems',(select count(*) from public.sale_items where organization_id='${ORGANIZATION_ID}'::uuid),
      'inventoryMovements',(select count(*) from public.inventory_movements where organization_id='${ORGANIZATION_ID}'::uuid)
    )
  )::text;`;
  return JSON.parse(runReadOnlySql(databaseUrl, sql));
}

async function authenticateChoices() {
  const choices = [
    ["TINDIO_PHASE_04_TEST_EMAIL", "TINDIO_PHASE_04_TEST_PASSWORD"],
    ["TINDIO_PHASE_05_TEST_EMAIL", "TINDIO_PHASE_05_TEST_PASSWORD"],
  ].filter(([email, password]) => process.env[email]?.trim() && process.env[password]?.trim());
  assert.ok(choices.length > 0, "No certification credentials are configured.");
  const authenticated = [];
  const failures = [];
  for (const [emailName, passwordName] of choices) {
    const response = await fetch(`${required("NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/u, "")}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), "Content-Type": "application/json" },
      body: JSON.stringify({ email: required(emailName), password: required(passwordName) }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json();
    if (response.status === 200 && typeof body.access_token === "string") {
      authenticated.push({ credential: emailName, token: body.access_token });
    } else {
      failures.push(`${emailName}:${response.status}`);
    }
  }
  assert.ok(authenticated.length > 0, `Certification authentication failed (${failures.join(", ")}).`);
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

function assertCustodyRejection(result, expectedMessage) {
  assert.notEqual(result.status, 200, "Custody-protected mutation unexpectedly succeeded.");
  assert.notEqual(result.status, 204, "Custody-protected mutation unexpectedly succeeded.");
  assert.equal(result.body?.code, "23514");
  assert.equal(result.body?.message, expectedMessage);
}

async function attemptWithAuthorizedIdentity(authenticated, name, body, expectedMessage) {
  const permissionDenials = [];
  for (const identity of authenticated) {
    const result = await rpc(identity.token, name, body);
    if (result.body?.code === "42501") {
      permissionDenials.push({ credential: identity.credential, status: result.status, body: result.body });
      continue;
    }
    assertCustodyRejection(result, expectedMessage);
    return { credential: identity.credential, ...result, permissionDenials };
  }
  assert.fail(`No configured certification identity was authorized for ${name}.`);
}

const before = readSnapshot();
assert.equal(before.device?.status, "active", "Certification device must be active.");
assert.equal(before.shift?.status, "open", "Certification shift must be open.");
assert.equal(before.lease?.state, "ACTIVE", "Certification device must hold active shift custody.");

if (action === "status") {
  console.log(JSON.stringify({ action, before }));
  process.exit(0);
}

const authenticated = await authenticateChoices();
const closeAttempt = await attemptWithAuthorizedIdentity(authenticated, "close_register_shift", {
  target_organization_id: ORGANIZATION_ID,
  target_shift_id: SHIFT_ID,
  target_counted_cash_minor: 0,
  target_closing_note: "A33 custody guard certification attempt",
}, "Shift close blocked while a device has active offline transaction custody.");

const reassignAttempt = before.alternateRegister?.id
  ? await attemptWithAuthorizedIdentity(authenticated, "change_pos_device_register", {
      target_organization_id: ORGANIZATION_ID,
      target_device_id: DEVICE_ID,
      target_store_id: before.alternateRegister.storeId,
      target_register_id: before.alternateRegister.id,
    }, "This device has active offline shift custody. Reconcile and close the shift before reassigning or revoking it.")
  : { status: "NOT_RUN", body: { message: "No different active certification register exists." } };
const revokeAttempt = await attemptWithAuthorizedIdentity(authenticated, "revoke_pos_device", {
  target_organization_id: ORGANIZATION_ID,
  target_device_id: DEVICE_ID,
  target_reason: "A33 custody guard certification attempt",
}, "This device has active offline shift custody. Reconcile and close the shift before reassigning or revoking it.");

const after = readSnapshot();
assert.deepEqual(after.device, before.device, "A rejected A33 device mutation changed the device.");
assert.deepEqual(after.shift, before.shift, "A rejected A33 close changed the shift.");
assert.deepEqual(after.lease, before.lease, "A rejected A33 mutation changed custody.");
assert.deepEqual(after.checkpoint, before.checkpoint, "A rejected A33 mutation changed the device checkpoint.");
assert.deepEqual(after.financialCounts, before.financialCounts, "A rejected A33 mutation changed financial history.");

console.log(JSON.stringify({ action, before, attempts: { closeAttempt, reassignAttempt, revokeAttempt }, after }));
