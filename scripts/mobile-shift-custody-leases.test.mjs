import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");
const migration = read("database/migrations/0013_mobile_shift_custody_leases.sql");
const conflictTargetFix = read("database/migrations/0014_mobile_shift_custody_conflict_target.sql");
const service = read("src/features/shifts/service.ts");
const closeRoute = read("src/app/api/pos/v2/shifts/close/route.ts");
const custodyRoute = read("src/app/api/pos/v2/shifts/custody/route.ts");
const offlinePreparation = read("apps/mobile/src/features/offline/prepare-offline-mode.ts");

test("MOB-08 server custody is private, tenant-scoped, and never expires implicitly", () => {
  for (const marker of [
    "create table if not exists private.pos_shift_custody_leases",
    "primary key (organization_id, shift_id, device_id)",
    "alter table private.pos_shift_custody_leases enable row level security",
    "revoke all on table private.pos_shift_custody_leases from tindio_authenticated",
    "target_organization_id",
    "private.require_enrolled_offline_pos_device",
  ]) assert.ok(migration.toLowerCase().includes(marker.toLowerCase()), marker);
  assert.doesNotMatch(migration, /expires_at|delete\s+from\s+private\.pos_shift_custody_leases/i);
  assert.match(migration, /private\.verify_pos_device_credential/);
  assert.doesNotMatch(migration.slice(migration.indexOf("create or replace function private.require_enrolled_offline_pos_device"), migration.indexOf("create or replace function private.acquire_pos_shift_custody")), /device_management_enabled/);
});

test("MOB-08 every close path respects active custody and mobile close is atomic", () => {
  const standardClose = migration.slice(
    migration.indexOf("create or replace function private.close_register_shift"),
    migration.indexOf("create or replace function public.close_register_shift_mobile"),
  );
  const mobileClose = migration.slice(migration.indexOf("create or replace function public.close_register_shift_mobile"));
  assert.match(standardClose, /state = 'ACTIVE'/);
  assert.match(mobileClose, /for update/);
  assert.match(mobileClose, /server_checkpoint/);
  assert.match(mobileClose, /is distinct from target_local_high_water/);
  assert.match(mobileClose, /finalization_token=target_finalization_token/);
  assert.match(mobileClose, /state='CLEARED'/);
  assert.match(mobileClose, /null::bigint,null::bigint,null::bigint,null::timestamptz,false,false/);
  assert.match(mobileClose, /linked_state = 'CLEARED'/);
  assert.match(mobileClose, /private\.close_register_shift/);
  assert.match(mobileClose, /was_replayed/);
  assert.match(mobileClose, /private\.has_permission\(target_organization_id, 'shifts\.close'\)/);
  assert.match(mobileClose, /opened_by_employee_id is distinct from actor_employee_id/);
});

test("MOB-08 device reassignment and revocation cannot strand active custody", () => {
  assert.match(migration, /before update of store_id, register_id, status on public\.pos_devices/);
  assert.match(migration, /old\.organization_id[\s\S]*old\.id[\s\S]*state = 'ACTIVE'/);
  assert.match(migration, /before reassigning or revoking/i);
});

test("MOB-08 mobile preparation acquires custody before granting offline authority", () => {
  const acquireAt = offlinePreparation.indexOf("acquirePosV2ShiftCustody(");
  const grantAt = offlinePreparation.indexOf("saveOfflineAuthorizationGrant(");
  assert.ok(acquireAt >= 0 && acquireAt < grantAt);
  assert.match(offlinePreparation, /SHIFT_CUSTODY_UNAVAILABLE/);
  assert.match(offlinePreparation, /isShiftFinalizationInProgress/);
  assert.ok(offlinePreparation.indexOf("isShiftFinalizationInProgress") < acquireAt);
  assert.match(service, /posDeviceRequestHeaders\(parsed\.data\.device\)/);
  assert.match(custodyRoute, /getPosV2BusinessContext/);
  assert.match(closeRoute, /closeMobileShift/);
});

test("MOB-08 RPC exposure is explicit and limited to authenticated callers", () => {
  for (const signature of [
    "public.acquire_pos_shift_custody(uuid,uuid)",
    "public.close_register_shift_mobile(uuid,uuid,bigint,text,bigint,uuid)",
  ]) {
    assert.ok(migration.includes(`revoke all on function ${signature} from public`));
    assert.ok(migration.includes(`revoke all on function ${signature} from tindio_anon`));
    assert.ok(migration.includes(`grant execute on function ${signature} to tindio_authenticated`));
  }
});

test("MOB-10 custody renewal has an unambiguous conflict target", () => {
  assert.match(
    conflictTargetFix,
    /on conflict on constraint pos_shift_custody_leases_pkey do update/i,
  );
  assert.doesNotMatch(
    conflictTargetFix,
    /on conflict\s*\(\s*organization_id\s*,\s*shift_id\s*,\s*device_id\s*\)/i,
  );
  assert.doesNotMatch(conflictTargetFix, /delete\s+from/i);
});
