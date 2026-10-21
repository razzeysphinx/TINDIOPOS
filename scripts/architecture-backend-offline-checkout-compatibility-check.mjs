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

test("offline checkout has a focused platform-neutral contract", async () => {
  const [manifestSource, contract] = await Promise.all([
    read("packages/contracts/package.json"),
    read("packages/contracts/src/offline-checkout.ts"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(manifest.exports["./offline-checkout"].types, "./src/offline-checkout.ts");
  for (const value of [
    "POS_OFFLINE_CHECKOUT_PATH", "POS_OFFLINE_CHECKOUT_DEVICE_RPC",
    "POS_OFFLINE_CHECKOUT_RESERVE_RPC", "POS_OFFLINE_CHECKOUT_FINALIZE_RPC",
    "POS_OFFLINE_CHECKOUT_RECORD_RPC", "POS_OFFLINE_CHECKOUT_SEQUENCE_STATUSES",
    "POS_OFFLINE_CHECKOUT_TERMINAL_CONFLICTS", "offlineCheckoutRequestSchema",
    "OfflineCheckoutRequest", "OfflineCheckoutResult",
  ]) assert.match(contract, new RegExp(`\\b${value}\\b`));
  for (const value of [
    '"/api/pos/v2/offline-checkout"', '"validate_pos_device"',
    '"reserve_pos_device_sequence"', '"finalize_pos_device_sequence"',
    '"record_offline_sync_event"', '"DEVICE_REVOKED"',
  ]) assert.ok(contract.includes(value), `missing shared offline value ${value}`);
  assert.doesNotMatch(
    contract,
    /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/,
  );
});

test("Web rollback route and sync push retain the ordered offline processor", async () => {
  const [route, service, syncPush, checkout] = await Promise.all([
    read("src/app/api/pos/v2/offline-checkout/route.ts"),
    read("src/features/offline/pos-v2-offline-checkout-service.ts"),
    read("src/app/api/pos/v2/sync/push/route.ts"),
    read("src/features/checkout/checkout-service.ts"),
  ]);

  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function (?:GET|PUT|PATCH|DELETE)/);
  assert.ok(route.indexOf("getPosV2BusinessContext(request)") < route.indexOf("request.json()"));
  assert.match(route, /processPosV2OfflineCheckout/);
  assert.match(route, /POS_OFFLINE_CHECKOUT_INVALID_MESSAGE/);
  assert.match(route, /POS_OFFLINE_CHECKOUT_UNCONFIRMED_MESSAGE/);
  assert.match(service, /checkoutSubmissionSchema\.safeParse\(input\)/);
  assert.ok(service.indexOf("await reserve(context,input)") < service.indexOf("completeCheckout(context,input"));
  assert.ok(service.indexOf("completeCheckout(context,input") < service.indexOf("await finalize(context,input"));
  assert.match(service, /completeCheckout\(context,input,\{guardOfflineTotal:true\}\)/);
  for (const rpc of [
    "validate_pos_device", "reserve_pos_device_sequence",
    "finalize_pos_device_sequence", "record_offline_sync_event",
  ]) assert.ok(service.includes(`.rpc("${rpc}"`), `missing Web offline RPC ${rpc}`);
  assert.match(syncPush, /processPosV2OfflineCheckout/);
  assert.match(checkout, /POS_OFFLINE_CHECKOUT_TOTAL_MESSAGE/);
  assert.match(checkout, /POS_OFFLINE_CHECKOUT_PAYMENT_METHOD_MESSAGE/);
});

test("Backend offline oracle is isolated and no owned route exists", async () => {
  const oracle = await read("apps/backend/src/pos/offline-checkout-compatibility.ts");

  for (const value of [
    "OFFLINE_CHECKOUT_COMPATIBILITY_CONTRACT", "validateOfflineCheckout",
    "validateOfflinePaymentMethod", "offlineSequenceIntent",
    "mapOfflineSequenceReservation", "offlineCheckoutFailureCode",
    "offlineSequenceFinalState", "mapOfflineSequenceFinalization",
    "shouldRecordOfflineOutcome", "toOfflineRecordArguments",
    "offlineCheckoutResponseStatus",
  ]) assert.match(oracle, new RegExp(`\\b${value}\\b`));
  assert.doesNotMatch(
    oracle,
    /fetch\(|createPosReadRuntime|createNeonDataApiFetch|@supabase|@neon|process\.env/,
  );
  assert.equal(
    existsSync(new URL("../apps/backend/api/pos/v2/offline-checkout.ts", import.meta.url)),
    false,
  );
});

test("database authority retains device sequence, outcome, and total guards", async () => {
  const baseline = await read("database/baseline/0001_tindio_baseline.sql");
  const validate = functionBody(baseline, "validate_pos_device");
  const reserve = functionBody(baseline, "reserve_pos_device_sequence");
  const finalize = functionBody(baseline, "finalize_pos_device_sequence");
  const record = functionBody(baseline, "record_offline_sync_event");

  for (const body of [validate, reserve, finalize, record]) {
    assert.match(body, /SECURITY DEFINER/);
    assert.match(body, /SET "search_path" TO ''/);
  }
  assert.match(validate, /private\.verify_pos_device_credential/);
  assert.match(validate, /private\.has_permission\(target_organization_id, 'sales\.create'\)/);
  assert.match(reserve, /private\.require_pos_sequence_access/);
  for (const status of [
    "REPLAY", "DUPLICATE_SEQUENCE", "IDEMPOTENCY_SEQUENCE_MISMATCH",
    "GAP", "OUT_OF_ORDER", "ACCEPTED",
  ]) assert.ok(reserve.includes(`'${status}'`), `missing sequence status ${status}`);
  assert.match(reserve, /'RECEIVED'/);
  assert.match(finalize, /'APPLIED','CONFLICT'/);
  assert.match(finalize, /server_checkpoint=target_device_sequence/);
  assert.match(record, /private\.has_permission\(target_organization_id, 'sales\.create'\)/);
  assert.match(record, /opened_by_employee_id = actor_employee_id/);
  assert.match(record, /device\.store_id = target_store_id/);
  assert.match(record, /device\.register_id = target_register_id/);
  assert.match(record, /on conflict \(organization_id, idempotency_key\) do update/);
  assert.match(baseline, /tindio-offline-total/);
  assert.match(baseline, /queued sale total changed while offline/i);
  for (const name of [
    "validate_pos_device", "reserve_pos_device_sequence",
    "finalize_pos_device_sequence", "record_offline_sync_event",
  ]) {
    assert.match(baseline, new RegExp(`REVOKE ALL ON FUNCTION "public"\\."${name}"[\\s\\S]+?FROM PUBLIC;`));
    assert.match(baseline, new RegExp(`GRANT ALL ON FUNCTION "public"\\."${name}"[\\s\\S]+?TO "tindio_authenticated";`));
  }
});

test("D28 keeps clients and adjacent mutations on their existing paths", async () => {
  const [webReplay, mobileApi, readme, refund, transfer, attendance] = await Promise.all([
    read("src/features/offline/offline-sync.ts"),
    read("apps/mobile/src/lib/tindio-api.ts"),
    read("apps/backend/README.md"),
    read("src/app/api/pos/v2/receipts/[receiptId]/refund/route.ts"),
    read("src/app/api/pos/v2/transfers/[transferId]/receive/route.ts"),
    read("src/app/api/pos/v2/attendance/clock-in/route.ts"),
  ]);

  assert.match(webReplay, /fetchPosV2Command\(POS_OFFLINE_CHECKOUT_PATH/);
  assert.match(webReplay, /@tindio\/contracts\/offline-checkout/);
  assert.match(mobileApi, /request\("\/api\/pos\/v2\/sync\/push"/);
  assert.doesNotMatch(mobileApi, /POS_OFFLINE_CHECKOUT_PATH|TINDIO_WEB_API_ORIGIN|apps\/backend/);
  for (const mutation of [refund, transfer, attendance]) assert.match(mutation, /export async function POST/);
  assert.match(readme, /Slice D28 offline-checkout compatibility oracle/);
  assert.match(readme, /No\s+Backend offline-checkout route or runtime mode exists/);
});
