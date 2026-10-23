import assert from "node:assert/strict";
import test from "node:test";
import {
  SHIFT_CONTROL_COMPATIBILITY_CONTRACT,
  mapCashMovementResult,
  mapMobileCloseShiftResult,
  mapOpenShiftResult,
  mapShiftCustodyResult,
  shiftDatabaseMessage,
  shiftMoneyInputToMinor,
  toCashMovementRpcArguments,
  toMobileCloseShiftRpcArguments,
  toOpenShiftRpcArguments,
  toShiftCustodyRpcArguments,
  validateCashMovement,
  validateMobileCloseShift,
  validateOpenShift,
  validateShiftCustody,
} from "../dist/src/pos/shift-control-compatibility.js";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const STORE_ID = "10000000-0000-4000-8000-000000000001";
const REGISTER_ID = "20000000-0000-4000-8000-000000000001";
const SHIFT_ID = "30000000-0000-4000-8000-000000000001";
const DEVICE_ID = "40000000-0000-4000-8000-000000000001";
const KEY = "50000000-0000-4000-8000-000000000001";
const APPROVAL_ID = "60000000-0000-4000-8000-000000000001";
const TOKEN = "70000000-0000-4000-8000-000000000001";
const DEVICE = { deviceId: DEVICE_ID, secret: "a".repeat(64), appVersion: "mobile-1.0.0" };

test("shift compatibility freezes all four Web-owned routes and custody dimensions", () => {
  assert.deepEqual(Object.values(SHIFT_CONTROL_COMPATIBILITY_CONTRACT.routes).map((route) => route.path), [
    "/api/pos/v2/shifts/open", "/api/pos/v2/shifts/close", "/api/pos/v2/shifts/custody", "/api/pos/v2/shifts/cash-movement",
  ]);
  assert.equal(SHIFT_CONTROL_COMPATIBILITY_CONTRACT.routes.close.legacyStatus, 426);
  assert.deepEqual(SHIFT_CONTROL_COMPATIBILITY_CONTRACT.custody, ["organization", "employee", "device", "store", "register", "shift", "checkpoint", "finalization-token"]);
});

test("shift money conversion retains exact two-decimal minor-unit semantics", () => {
  assert.equal(shiftMoneyInputToMinor("0"), 0);
  assert.equal(shiftMoneyInputToMinor(" 12.3 "), 1230);
  assert.equal(shiftMoneyInputToMinor("9999999999.99"), 999999999999);
});

test("open shift preserves permission-first validation and exact RPC projection", () => {
  const input = { storeId: STORE_ID, registerId: REGISTER_ID, openingCash: "12.30", openingNote: "  Ready  ", device: DEVICE };
  assert.equal(validateOpenShift(input, { permissions: [] }).body.message, "You do not have permission to open register shifts.");
  const parsed = validateOpenShift(input, { permissions: ["shifts.open"] });
  assert.equal(parsed.ok, true);
  assert.deepEqual(toOpenShiftRpcArguments(ORGANIZATION_ID, parsed.input), {
    target_organization_id: ORGANIZATION_ID, target_store_id: STORE_ID, target_register_id: REGISTER_ID,
    target_opening_cash_minor: 1230, target_opening_note: "Ready",
  });
});

test("open shift maps new, replayed, and database failures exactly", () => {
  const input = { storeId: STORE_ID, registerId: REGISTER_ID, openingCash: "12.30", openingNote: "Ready", device: null };
  const row = { shift_id: SHIFT_ID, opened_at: "2026-10-23T08:00:00.000Z", was_replayed: false };
  assert.equal(mapOpenShiftResult(input, [row], null).body.message, "Register shift opened.");
  assert.equal(mapOpenShiftResult(input, [{ ...row, was_replayed: true }], null).body.message, "This shift is already open.");
  assert.equal(mapOpenShiftResult(input, null, { code: "23505", message: "This register already has an open shift." }).body.message,
    "This register has an open shift. Ask a staff member with Shift closing permission to review and close it before opening another.");
});

test("mobile close preserves permission, upgrade, validation, and exact checkpoint projection", () => {
  assert.equal(validateMobileCloseShift({}, { permissions: [] }).body.message, "You do not have permission to close register shifts.");
  const legacy = validateMobileCloseShift({ shiftId: SHIFT_ID, countedCash: "10.00" }, { permissions: ["shifts.close"] });
  assert.equal(legacy.status, 426); assert.equal(legacy.body.code, "POS_CLIENT_UPGRADE_REQUIRED");
  const input = { shiftId: SHIFT_ID, countedCash: "10.00", closingNote: "  Closed  ", device: DEVICE, localHighWater: 9, finalizationToken: TOKEN };
  const parsed = validateMobileCloseShift(input, { permissions: ["shifts.close"] });
  assert.equal(parsed.ok, true);
  assert.deepEqual(toMobileCloseShiftRpcArguments(ORGANIZATION_ID, parsed.input), {
    target_organization_id: ORGANIZATION_ID, target_shift_id: SHIFT_ID, target_counted_cash_minor: 1000,
    target_closing_note: "Closed", target_local_high_water: 9, target_finalization_token: TOKEN,
  });
});

test("mobile close maps pending multi-device custody, replay, and cash summary", () => {
  assert.equal(mapMobileCloseShiftResult([{ closed: false }], null).body.message,
    "This device is reconciled, but another device still has offline transaction custody. Bring every device online and retry this same close.");
  const result = mapMobileCloseShiftResult([{ closed: true, was_replayed: true, expected_cash_minor: "1200", counted_cash_minor: "1100", difference_minor: "-100" }], null).body;
  assert.equal(result.message, "This shift close was already recorded.");
  assert.deepEqual(result.closeSummary, { expectedCashMinor: 1200, countedCashMinor: 1100, differenceMinor: -100 });
});

test("custody requires an enrolled device and binds the returned identity", () => {
  assert.equal(validateShiftCustody({ shiftId: SHIFT_ID }).ok, false);
  const parsed = validateShiftCustody({ shiftId: SHIFT_ID, device: DEVICE });
  assert.deepEqual(toShiftCustodyRpcArguments(ORGANIZATION_ID, parsed.input), { target_organization_id: ORGANIZATION_ID, target_shift_id: SHIFT_ID });
  assert.equal(mapShiftCustodyResult(parsed.input, [{ device_id: STORE_ID, shift_id: SHIFT_ID }], null).body.ok, false);
  assert.deepEqual(mapShiftCustodyResult(parsed.input, [{ device_id: DEVICE_ID, shift_id: SHIFT_ID }], null).body, { ok: true, deviceId: DEVICE_ID, shiftId: SHIFT_ID, state: "ACTIVE" });
});

test("cash movement validates before permission and accepts exact permission or approval", () => {
  assert.equal(validateCashMovement(null, { permissions: [] }).body.message, "Enter a positive amount and a reason of at least two characters.");
  const base = { shiftId: SHIFT_ID, movementType: "PAY_OUT", amount: "5.00", reason: "Petty cash", idempotencyKey: KEY };
  assert.equal(validateCashMovement(base, { permissions: [] }).body.message, "You do not have permission for this cash movement.");
  assert.equal(validateCashMovement(base, { permissions: ["cash.pay_out"] }).ok, true);
  assert.equal(validateCashMovement({ ...base, approvalRequestId: APPROVAL_ID }, { permissions: [] }).ok, true);
});

test("cash movement projects optional approval and maps replay exactly", () => {
  const input = { shiftId: SHIFT_ID, movementType: "PAY_IN", amount: "5.25", reason: "Float", idempotencyKey: KEY, approvalRequestId: APPROVAL_ID };
  assert.deepEqual(toCashMovementRpcArguments(ORGANIZATION_ID, input), {
    target_organization_id: ORGANIZATION_ID, target_shift_id: SHIFT_ID, target_movement_type: "PAY_IN",
    target_amount_minor: 525, target_reason: "Float", target_idempotency_key: KEY, target_approval_request_id: APPROVAL_ID,
  });
  assert.equal(mapCashMovementResult([{ was_replayed: false }], null).body.message, "Cash movement recorded.");
  assert.equal(mapCashMovementResult([{ was_replayed: true }], null).body.message, "That cash movement was already recorded.");
});

test("database error mapping exposes only established business messages", () => {
  assert.equal(shiftDatabaseMessage({ code: "42501", message: "Device custody rejected." }, "fallback"), "Device custody rejected.");
  assert.equal(shiftDatabaseMessage({ code: "42501", message: "internal" }, "fallback"), "You do not have permission for this cash operation.");
  assert.equal(shiftDatabaseMessage({ code: "23514", message: "The device sequence is not fully reconciled for shift close." }, "fallback"), "The device sequence is not fully reconciled for shift close.");
  assert.equal(shiftDatabaseMessage({ code: "XX000", message: "provider detail" }, "fallback"), "fallback");
});
