import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function functionBody(source, schema, name) {
  const patterns = [`CREATE OR REPLACE FUNCTION "${schema}"."${name}"`, `create or replace function ${schema}.${name}`];
  const start = Math.max(...patterns.map((pattern) => source.indexOf(pattern)));
  assert.ok(start >= 0, `missing database function ${schema}.${name}`);
  const upperEnd = source.indexOf("\n--\n-- Name:", start + 1);
  const lowerEnd = source.indexOf("\n$$;", start + 1);
  const end = upperEnd > start ? upperEnd : lowerEnd > start ? lowerEnd + 4 : source.length;
  return source.slice(start, end);
}

test("device and sync-control contracts are focused and platform-neutral", async () => {
  const [manifestSource, index, device, sync] = await Promise.all([
    read("packages/contracts/package.json"), read("packages/contracts/src/index.ts"),
    read("packages/contracts/src/device.ts"), read("packages/contracts/src/sync-control.ts"),
  ]);
  const manifest = JSON.parse(manifestSource);
  assert.equal(manifest.exports["./device"].types, "./src/device.ts");
  assert.equal(manifest.exports["./sync-control"].types, "./src/sync-control.ts");
  assert.match(index, /export \* from "\.\/device"/);
  assert.match(index, /export \* from "\.\/sync-control"/);
  for (const value of ["POS_DEVICE_VALIDATION_PATH", "POS_DEVICE_ENROLLMENT_PATH", "POS_DEVICE_VALIDATION_RPC", "registerPosDeviceSchema"]) assert.match(device, new RegExp(`\\b${value}\\b`));
  for (const value of ["POS_SYNC_BASELINE_PATH", "POS_SYNC_CHECKPOINT_PATH", "POS_SYNC_PULL_PATH", "POS_SYNC_RESNAPSHOT_PATH", "POS_SYNC_TELEMETRY_PATH", "posSyncPullRequestSchema", "posSyncTelemetryRequestSchema"]) assert.match(sync, new RegExp(`\\b${value}\\b`));
  for (const source of [device, sync]) assert.doesNotMatch(source, /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/);
});

test("all seven Web routes retain context-first authority and shared contracts", async () => {
  const paths = [
    "src/app/api/pos/v2/device/route.ts", "src/app/api/pos/v2/device/enroll/route.ts",
    "src/app/api/pos/v2/sync/baseline/route.ts", "src/app/api/pos/v2/sync/checkpoint/route.ts",
    "src/app/api/pos/v2/sync/pull/route.ts", "src/app/api/pos/v2/sync/resnapshot/route.ts",
    "src/app/api/pos/v2/sync/telemetry/route.ts",
  ];
  const sources = await Promise.all(paths.map(read));
  for (const [index, source] of sources.entries()) {
    const bodyRead = source.includes("request.json()") ? source.indexOf("request.json()") : source.indexOf("readPosApiJson(request)");
    assert.ok(bodyRead >= 0 && source.indexOf("getPosV2BusinessContext(request)") < bodyRead);
    assert.match(source, /@tindio\/contracts\/(?:device|sync-control)/);
    if (index !== 1) assert.match(source, /private, no-store/);
  }
  const [service, response] = await Promise.all([
    read("src/features/offline/pos-v2-sync-service.ts"),
    read("src/features/pos/pos-api-response.ts"),
  ]);
  assert.match(response, /private, no-store/);
  assert.match(service, /posSyncDeviceRequestSchema/);
  assert.match(service, /posSyncPullRequestSchema/);
  assert.match(service, /POS_SYNC_DEVICE_RPC/);
  const validationBody = service.slice(service.indexOf("export async function validatedSyncDevice"));
  assert.ok(validationBody.indexOf("input.organizationId!==context.organization.id") < validationBody.indexOf("createBusinessContextClient"));
});

test("Backend oracle is isolated and no device or sync-control route owns traffic yet", async () => {
  const oracle = await read("apps/backend/src/pos/device-sync-compatibility.ts");
  for (const value of [
    "DEVICE_SYNC_COMPATIBILITY_CONTRACT", "validateDeviceRequest", "mapDeviceValidationResult",
    "validateDeviceEnrollment", "mapDeviceEnrollmentResult", "validateSyncPullRequest",
    "mapSyncCheckpoint", "createSyncCursorExpiredResponse", "validateSyncResnapshot",
    "validateSyncTelemetry", "toSyncTelemetryRpcArguments",
  ]) assert.match(oracle, new RegExp(`\\b${value}\\b`));
  assert.doesNotMatch(oracle, /fetch\(|createPosReadRuntime|createNeonDataApiFetch|@supabase|@neon|process\.env/);
  for (const path of [
    "apps/backend/api/pos/v2/device.ts", "apps/backend/api/pos/v2/device/enroll.ts",
    "apps/backend/api/pos/v2/sync/baseline.ts", "apps/backend/api/pos/v2/sync/checkpoint.ts",
    "apps/backend/api/pos/v2/sync/pull.ts", "apps/backend/api/pos/v2/sync/resnapshot.ts",
    "apps/backend/api/pos/v2/sync/telemetry.ts",
  ]) assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), false, `${path} must wait for D43`);
});

test("database authority preserves device, checkpoint, cursor, resnapshot, and telemetry custody", async () => {
  const [baseline, retention, telemetry] = await Promise.all([
    read("database/baseline/0001_tindio_baseline.sql"),
    read("database/migrations/0016_mobile_sync_retention_resnapshot.sql"),
    read("database/migrations/0019_mobile_a45_operational_alerts.sql"),
  ]);
  const validate = functionBody(baseline, "public", "validate_pos_device");
  const enroll = functionBody(baseline, "public", "register_pos_device");
  const checkpoint = functionBody(baseline, "public", "get_pos_device_sync_checkpoint");
  const window = functionBody(baseline, "public", "get_pos_sync_change_window");
  const resnapshot = functionBody(retention, "public", "get_pos_sync_resnapshot_v1");
  const report = functionBody(telemetry, "public", "report_pos_device_sync_telemetry");
  assert.match(validate, /private\.current_employee_id/);
  assert.match(validate, /private\.has_permission\(target_organization_id, 'sales\.create'\)/);
  assert.match(validate, /private\.verify_pos_device_credential/);
  assert.match(validate, /public\.employee_stores/);
  assert.match(enroll, /private\.require_device_manager/);
  assert.match(enroll, /private\.require_active_device_binding/);
  assert.match(enroll, /insert into public\.pos_devices/);
  assert.match(enroll, /insert into private\.pos_device_credentials/);
  assert.match(checkpoint, /private\.require_pos_sequence_access/);
  assert.match(window, /target_limit not between 1 and 200/);
  assert.match(window, /private\.require_pos_sync_access/);
  assert.match(retention, /private\.pos_sync_retention_state/);
  assert.match(resnapshot, /private\.require_pos_sync_access/);
  assert.match(resnapshot, /'storeId', selected_store_id/);
  assert.match(report, /actor_employee_id <> target_employee_id/);
  assert.match(report, /verified_store_id <> target_store_id or verified_register_id <> target_register_id/);
  assert.match(report, /public\.employee_stores/);
  assert.match(telemetry, /grant execute on function public\.report_pos_device_sync_telemetry[\s\S]+to tindio_authenticated;/);
  for (const rpc of ["validate_pos_device", "register_pos_device", "get_pos_device_sync_checkpoint", "get_pos_sync_change_window", "get_pos_sync_revision", "get_pos_sync_customer"]) {
    assert.match(baseline, new RegExp(`GRANT ALL ON FUNCTION "public"\\."${rpc}"[\\s\\S]+?TO "tindio_authenticated";`));
  }
  for (const rpc of ["get_pos_sync_retention_state", "get_pos_sync_resnapshot_v1"]) assert.match(retention, new RegExp(`grant execute on function public\\.${rpc}[\\s\\S]+to tindio_authenticated;`));
});

test("D41 ownership and adjacent shift, approval, and stock routes remain unchanged", async () => {
  const [settings, delivery, shift, approval, stock, backendReadme] = await Promise.all([
    read("apps/backend/api/pos/v2/receipt-settings.ts"), read("apps/backend/api/pos/v2/receipts/[receiptId]/delivery.ts"),
    read("src/app/api/pos/v2/shifts/open/route.ts"), read("src/app/api/pos/v2/approvals/request/route.ts"),
    read("src/app/api/pos/v2/cart/validate-stock/route.ts"), read("apps/backend/README.md"),
  ]);
  for (const source of [settings, delivery]) assert.match(source, /export async function POST/);
  for (const source of [shift, approval, stock]) assert.match(source, /getPosV2BusinessContext/);
  assert.match(backendReadme, /Slice D41 Backend-owned receipt administration/);
});
