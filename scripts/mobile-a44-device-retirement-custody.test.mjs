import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");
const migration = read("database/migrations/0018_mobile_device_retirement_custody.sql");
const custodyMigration = read("database/migrations/0013_mobile_shift_custody_leases.sql");
const schema = read("src/features/devices/device-schema.ts");
const actions = read("src/features/devices/actions.ts");
const manager = read("src/features/devices/device-manager.tsx");

test("A44 keeps ordinary custody blocking and makes legacy retirement fail safely", () => {
  assert.match(custodyMigration, /block_device_change_with_active_custody/);
  assert.match(custodyMigration, /lease\.state = 'ACTIVE'/);
  assert.match(migration, /create or replace function public\.revoke_pos_device/);
  assert.match(migration, /requires an explicit transaction-custody decision/);
  assert.doesNotMatch(migration, /drop trigger if exists block_pos_device_change_with_active_custody/);
});

test("A44 reconciled retirement requires current zero-risk cloud evidence", () => {
  for (const guard of [
    "active_custody_count > 0",
    "telemetry_record.connection_mode <> 'CLOUD_ONLINE'",
    "telemetry_record.queue_depth <> 0",
    "telemetry_record.conflict_count <> 0",
    "telemetry_record.failed_count <> 0",
    "telemetry_record.device_checkpoint > telemetry_record.server_checkpoint",
    "telemetry_record.last_heartbeat_at < now() - interval '15 minutes'",
  ]) assert.ok(migration.includes(guard), `missing reconciled retirement guard: ${guard}`);
  assert.match(migration, /Finaliz(?:e|ing) its shift before marking it reconciled/);
});

test("A44 unavailable-device decision is explicit, audited, and preserves loss evidence", () => {
  assert.match(schema, /DEVICE_UNAVAILABLE_ACCEPT_BOUNDED_LOSS/);
  assert.match(schema, /ACCEPT LOCAL-ONLY TRANSACTION LOSS/);
  assert.match(migration, /state = 'LOST'/);
  assert.match(migration, /loss_decided_by_employee_id = actor_employee_id/);
  assert.match(migration, /'store_hub_financial_backup', false/);
  assert.match(migration, /DEVICE_RETIRED_WITH_CUSTODY_DECISION/);
  assert.match(migration, /private\.require_device_manager\(target_organization_id\)/);
  assert.match(migration, /device\.organization_id = target_organization_id/);
  assert.match(migration, /notify pgrst, 'reload schema'/);
  assert.doesNotMatch(migration, /delete\s+from\s+(?:private\.pos_shift_custody_leases|public\.(?:sales|payments|receipts|inventory_movements|offline_sync_events))/i);
});

test("A44 Fleet Management explains bounded loss instead of claiming Hub backup", () => {
  assert.match(actions, /rpc\("retire_pos_device"/);
  assert.match(actions, /hasPermission\(context, "devices\.manage"\)/);
  assert.match(manager, /Reconciled with cloud/);
  assert.match(manager, /Terminal is lost or cannot be recovered/);
  assert.match(manager, /cannot be recovered/);
  assert.match(manager, /Store Hub has stock-awareness metadata, not a complete financial backup/);
  assert.match(manager, /new device ID and secret/i);
  assert.doesNotMatch(manager, /window\.confirm/);
});
