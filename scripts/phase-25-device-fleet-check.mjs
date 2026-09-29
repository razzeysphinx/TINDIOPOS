import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Phase 25 fleet page combines device registry and telemetry", () => {
  const page = read("src/app/(back-office)/back-office/devices/page.tsx");
  for (const marker of ["pos_devices", "pos_device_sync_telemetry", "app_version", "last_heartbeat_at", "last_successful_sync_at", "queue_depth", "conflict_count", "failed_count"]) {
    assert.ok(page.includes(marker), `fleet page must include ${marker}`);
  }
  assert.ok(page.includes('requireBackOfficePermission("devices.manage")') || page.includes('requireBackOfficePermission(\n      "devices.manage"'), "fleet page must require devices.manage");
});

test("Phase 25 fleet UI covers Source-of-Truth capabilities", () => {
  const manager = read("src/features/devices/device-manager.tsx");
  for (const marker of ["Deployment flow", "Business assignment", "Store assignment", "Register assignment", "Disable", "Replace", "App ", "Heartbeat", "Last successful sync", "Conflicts", "Last contact", "Initial Sync"]) {
    assert.ok(manager.includes(marker), `device manager must include ${marker}`);
  }
  assert.ok(manager.includes("Business assignment is locked to the authenticated tenant"), "business assignment must remain tenant-bound");
  assert.ok(manager.includes("NEW device ID and secret"), "device replacement must require a new identity");
});

test("Phase 25 preserves server-side device authority", () => {
  const actions = read("src/features/devices/actions.ts");
  const migration = read("supabase/migrations/20260824190000_improvement_12_device_register_management.sql");
  for (const marker of ["devices.manage", "register_pos_device", "change_pos_device_register", "revoke_pos_device"]) {
    assert.ok(actions.includes(marker), `device actions must retain ${marker}`);
  }
  assert.ok(migration.includes("private.pos_device_credentials") && migration.includes("extensions.digest(target_secret, 'sha256')"), "device credentials must remain private and hashed");
  assert.ok(migration.includes("device.organization_id = target_organization_id"), "device mutations must remain organization scoped");
});

test("Phase 25 native enrollment remains secure and self-generated", () => {
  const setup = read("apps/mobile/src/features/device/device-setup.tsx");
  const store = read("apps/mobile/src/features/device/device-store.ts");
  assert.ok(setup.includes("devices.manage") && setup.includes("createMobileDeviceCredential") && setup.includes("enrollPosV2Device"));
  assert.ok(store.includes("expo-crypto") && store.includes("secureStorage") && store.includes("`tindio.pos.device.${organizationId}`"));
  assert.doesNotMatch(setup + store, /service_role|DATABASE_URL|private\.pos_device_credentials/, "native enrollment must not receive server secrets or credential hashes");
});

test("Phase 25 fleet client does not mutate device tables directly", () => {
  assert.doesNotMatch(read("src/features/devices/device-manager.tsx"), /\.from\(["']pos_devices["']\)|UPDATE\s+pos_devices|INSERT\s+INTO\s+pos_devices/i, "fleet UI must use server actions rather than direct device table mutation");
});
