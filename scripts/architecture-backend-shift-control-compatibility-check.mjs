import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("shift-control contract is focused and platform-neutral", async () => {
  const [manifestSource, index, contract] = await Promise.all([
    read("packages/contracts/package.json"), read("packages/contracts/src/index.ts"), read("packages/contracts/src/shift-control.ts"),
  ]);
  const manifest = JSON.parse(manifestSource);
  assert.equal(manifest.exports["./shift-control"].types, "./src/shift-control.ts");
  assert.match(index, /export \* from "\.\/shift-control"/);
  for (const value of ["POS_SHIFT_OPEN_PATH", "POS_SHIFT_CLOSE_PATH", "POS_SHIFT_CUSTODY_PATH", "POS_SHIFT_CASH_MOVEMENT_PATH", "mobileCloseShiftSchema", "legacyMobileShiftCloseUpgrade"]) assert.match(contract, new RegExp(`\\b${value}\\b`));
  assert.doesNotMatch(contract, /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/);
});

test("all four Web routes retain context-first authority and the shared contract", async () => {
  const routes = await Promise.all([
    "open/route.ts", "close/route.ts", "custody/route.ts", "cash-movement/route.ts",
  ].map((route) => read(`src/app/api/pos/v2/shifts/${route}`)));
  for (const source of routes) {
    const body = source.indexOf("readPosApiJson(request)");
    assert.ok(source.indexOf("getPosV2BusinessContext(request)") < body && body >= 0);
    assert.match(source, /posApiJson/);
  }
  assert.match(routes[1], /isMobileShiftCloseUpgradeRequired/); assert.match(routes[1], /426/);
  const [schemaFacade, closeFacade, service] = await Promise.all([
    read("src/features/shifts/shift-schema.ts"), read("src/features/shifts/mobile-shift-close-compatibility.ts"), read("src/features/shifts/service.ts"),
  ]);
  assert.match(schemaFacade, /@tindio\/contracts\/shift-control/);
  assert.match(closeFacade, /@tindio\/contracts\/shift-control/);
  for (const rpc of ["open_register_shift", "close_register_shift_mobile", "acquire_pos_shift_custody", "record_cash_movement"]) assert.ok(service.includes(rpc));
});

test("Backend shift oracle is isolated and ownership waits for D45", async () => {
  const oracle = await read("apps/backend/src/pos/shift-control-compatibility.ts");
  for (const value of ["SHIFT_CONTROL_COMPATIBILITY_CONTRACT", "validateOpenShift", "mapOpenShiftResult", "validateMobileCloseShift", "mapMobileCloseShiftResult", "validateShiftCustody", "mapShiftCustodyResult", "validateCashMovement", "mapCashMovementResult"]) assert.match(oracle, new RegExp(`\\b${value}\\b`));
  assert.doesNotMatch(oracle, /fetch\(|createNeonDataApiFetch|@supabase|@neon|process\.env/);
  for (const path of ["open.ts", "close.ts", "custody.ts", "cash-movement.ts"]) {
    assert.equal(existsSync(new URL(`../apps/backend/api/pos/v2/shifts/${path}`, import.meta.url)), false, `${path} must wait for D45`);
  }
});

test("database authority retains shift, employee, device, checkpoint, cash, and replay custody", async () => {
  const [baseline, custody] = await Promise.all([
    read("database/baseline/0001_tindio_baseline.sql"), read("database/migrations/0013_mobile_shift_custody_leases.sql"),
  ]);
  const baselineLower = baseline.toLowerCase(); const custodyLower = custody.toLowerCase();
  for (const marker of ["private.has_permission(target_organization_id, 'shifts.open')", "public.employee_stores", "for update of register", "private.open_register_shift", "target_opening_cash_minor < 0"]) assert.ok(baselineLower.includes(marker), `missing ${marker}`);
  for (const marker of ["required_permission := case target_movement_type", "private.authorize_sensitive_operation", "private.record_cash_movement", "target_idempotency_key", "only the employee who opened this shift can record cash movements"]) assert.ok(baselineLower.includes(marker), `missing ${marker}`);
  for (const marker of ["private.require_enrolled_offline_pos_device", "opened_by_employee_id is distinct from actor_employee_id", "pos_device_sync_checkpoints", "current_checkpoint is distinct from target_local_high_water", "finalization_token", "state = 'active'", "state='cleared'", "private.calculate_shift_cash"]) assert.ok(custodyLower.includes(marker), `missing ${marker}`);
  assert.match(custody, /grant execute on function public\.acquire_pos_shift_custody[\s\S]+to tindio_authenticated;/i);
  assert.match(custody, /grant execute on function public\.close_register_shift_mobile[\s\S]+to tindio_authenticated;/i);
});

test("D43 ownership remains and adjacent approval and stock routes stay in Web", async () => {
  const [device, telemetry, approval, stock, readme] = await Promise.all([
    read("apps/backend/api/pos/v2/device.ts"), read("apps/backend/api/pos/v2/sync/telemetry.ts"),
    read("src/app/api/pos/v2/approvals/request/route.ts"), read("src/app/api/pos/v2/cart/validate-stock/route.ts"), read("apps/backend/README.md"),
  ]);
  for (const source of [device, telemetry]) assert.match(source, /export async function POST/);
  for (const source of [approval, stock]) assert.match(source, /getPosV2BusinessContext/);
  assert.match(readme, /Slice D44 shift-control compatibility oracle/);
});
