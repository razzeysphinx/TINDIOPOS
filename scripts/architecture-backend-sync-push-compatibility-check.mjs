import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function functionBody(source, name) {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION "public"."${name}"`);
  const end = source.indexOf("\n--\n-- Name:", start + 1);
  assert.ok(start >= 0 && end > start, `missing database function ${name}`);
  return source.slice(start, end);
}

test("sync push has a focused platform-neutral shared contract", async () => {
  const [manifestSource, contract] = await Promise.all([
    read("packages/contracts/package.json"),
    read("packages/contracts/src/sync-push.ts"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(manifest.exports["./sync-push"].types, "./src/sync-push.ts");
  for (const value of [
    "POS_SYNC_PUSH_PATH", "POS_SYNC_PUSH_DEVICE_RPC", "POS_SYNC_PUSH_OPERATION",
    "POS_SYNC_PUSH_VERSION", "POS_SYNC_PUSH_MAX_EVENTS",
    "POS_SYNC_PUSH_INVALID_MESSAGE", "POS_SYNC_PUSH_BATCH_MESSAGE",
    "POS_SYNC_PUSH_DEVICE_MESSAGE", "POS_SYNC_PUSH_UNAVAILABLE_MESSAGE",
    "posSyncPushEventSchema", "posSyncPushRequestSchema", "PosSyncPushRequest",
    "PosSyncPushAck", "PosSyncPushResponse",
  ]) assert.match(contract, new RegExp(`\\b${value}\\b`));
  assert.match(contract, /z\.array\(posSyncPushEventSchema\)\.min\(1\)\.max\(POS_SYNC_PUSH_MAX_EVENTS\)/);
  assert.doesNotMatch(
    contract,
    /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/,
  );
});

test("Web sync push retains context, ordered identity checks, device validation, and offline processing", async () => {
  const [route, service, syncControl] = await Promise.all([
    read("src/app/api/pos/v2/sync/push/route.ts"),
    read("src/features/offline/pos-v2-sync-service.ts"),
    read("packages/contracts/src/sync-control.ts"),
  ]);

  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function (?:GET|PUT|PATCH|DELETE)/);
  assert.ok(route.indexOf("getPosV2BusinessContext(request)") < route.indexOf("request.json()"));
  assert.match(service, /syncPushBodySchema=posSyncPushRequestSchema/);
  assert.match(service, /\.rpc\(POS_SYNC_DEVICE_RPC/);
  assert.match(syncControl, /POS_SYNC_DEVICE_RPC\s*=\s*"validate_pos_device"/);
  assert.match(route, /event\.offline\.deviceId!==parsed\.data\.device\.deviceId/);
  assert.match(route, /event\.offline\.deviceSequence<=last/);
  assert.match(route, /ids\.has\(event\.eventId\)/);
  assert.match(route, /keys\.has/);
  assert.match(route, /processPosV2OfflineCheckout/);
  assert.match(route, /if\(status!=="SYNCED"\)\{stoppedEarly=true;break;\}/);
  for (const value of [
    "POS_SYNC_PUSH_INVALID_MESSAGE", "POS_SYNC_PUSH_BATCH_MESSAGE",
    "POS_SYNC_PUSH_DEVICE_MESSAGE", "POS_SYNC_PUSH_UNAVAILABLE_MESSAGE",
    "POS_SYNC_PUSH_VERSION",
  ]) assert.match(route, new RegExp(`\\b${value}\\b`));
});

test("Backend sync-push oracle remains isolated beside the owned route", async () => {
  const oracle = await read("apps/backend/src/pos/sync-push-compatibility.ts");

  for (const value of [
    "SYNC_PUSH_COMPATIBILITY_CONTRACT", "validateSyncPushRequest",
    "validateSyncPushBatch", "toSyncPushDeviceRpcArguments", "mapSyncPushDevice",
    "toSyncPushOfflineSubmission", "createSyncPushAck", "shouldStopSyncPush",
    "createSyncPushResponse",
  ]) assert.match(oracle, new RegExp(`\\b${value}\\b`));
  assert.doesNotMatch(
    oracle,
    /fetch\(|createPosReadRuntime|createNeonDataApiFetch|@supabase|@neon|process\.env/,
  );
  assert.equal(
    existsSync(new URL("../apps/backend/api/pos/v2/sync/push.ts", import.meta.url)),
    true,
  );
});

test("database authority retains authenticated employee, permission, and device-store custody", async () => {
  const baseline = await read("database/baseline/0001_tindio_baseline.sql");
  const validate = functionBody(baseline, "validate_pos_device");

  assert.match(validate, /SECURITY DEFINER/);
  assert.match(validate, /SET "search_path" TO ''/);
  assert.match(validate, /private\.current_employee_id\(target_organization_id\)/);
  assert.match(validate, /private\.has_permission\(target_organization_id, 'sales\.create'\)/);
  assert.match(validate, /private\.verify_pos_device_credential/);
  assert.match(validate, /public\.employee_stores/);
  assert.match(validate, /employee_store\.store_id = verified\.store_id/);
  assert.match(baseline, /REVOKE ALL ON FUNCTION "public"\."validate_pos_device"[\s\S]+?FROM PUBLIC;/);
  assert.match(baseline, /GRANT ALL ON FUNCTION "public"\."validate_pos_device"[\s\S]+?TO "tindio_authenticated";/);
});

test("D30 keeps Mobile, ownership, deployment, auth, and adjacent mutations unchanged", async () => {
  const [mobileApi, outbox, readme, offline, refund, transfer, attendance] = await Promise.all([
    read("apps/mobile/src/lib/tindio-api.ts"),
    read("apps/mobile/src/features/outbox/outbox-sync.ts"),
    read("apps/backend/README.md"),
    read("apps/backend/api/pos/v2/offline-checkout.ts"),
    read("src/app/api/pos/v2/receipts/[receiptId]/refund/route.ts"),
    read("src/app/api/pos/v2/transfers/[transferId]/receive/route.ts"),
    read("src/app/api/pos/v2/attendance/clock-in/route.ts"),
  ]);

  assert.match(mobileApi, /request\("\/api\/pos\/v2\/sync\/push"/);
  assert.match(outbox, /pushPosV2SyncBatch/);
  assert.match(outbox, /events\.map/);
  assert.match(offline, /serveOfflineCheckout/);
  for (const mutation of [refund, transfer, attendance]) assert.match(mutation, /export async function POST/);
  assert.match(readme, /Slice D30 sync-push compatibility oracle/);
  assert.match(readme, /No\s+Backend sync-push route or runtime mode\s+exists/);
  assert.doesNotMatch(readme, /Slice D30[\s\S]{0,800}(?:deployed|production) (?:cutover|origin changed)/i);
});
