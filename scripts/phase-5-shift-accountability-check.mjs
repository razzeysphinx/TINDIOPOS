import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shiftManager = await readFile(
  new URL("../src/features/shifts/shift-manager.tsx", import.meta.url),
  "utf8",
);
const shiftActions = await readFile(
  new URL("../src/features/shifts/actions.ts", import.meta.url),
  "utf8",
);
const shiftMigration = await readFile(
  new URL("../supabase/migrations/20260821120000_phase_6_register_shifts.sql", import.meta.url),
  "utf8",
);

test("closed shifts provide a printout from immutable stored close values", () => {
  assert.match(shiftManager, /Shift-close audit trail/);
  assert.match(shiftManager, /ShiftClosePrintButton/);
  assert.match(shiftManager, /window\.open\("", "tindio-shift-close"/);
  assert.match(shiftManager, /expectedCashMinor=\{shift\.expectedCashMinor \?\? 0\}/);
  assert.match(shiftManager, /countedCashMinor=\{shift\.countedCashMinor \?\? 0\}/);
});

test("current cash accountability UI retains the existing operational controls", () => {
  assert.match(shiftManager, /CashExpectation/);
  assert.match(shiftManager, /BlindCashNotice/);
  assert.match(shiftManager, /movementType="PAY_IN"/);
  assert.match(shiftManager, /movementType="PAY_OUT"/);
  assert.match(shiftManager, /ManagerApprovalDialog/);
  assert.match(shiftManager, /CashCloseRecordedNotice/);
});

test("shift commands remain validated server actions backed by authoritative RPCs", () => {
  assert.match(shiftActions, /closeShiftSchema\.safeParse/);
  assert.match(shiftActions, /cashMovementSchema\.safeParse/);
  assert.match(shiftActions, /\.rpc\("close_register_shift"/);
  assert.match(shiftActions, /\.rpc\("record_cash_movement"/);
  assert.match(shiftActions, /hasPermission\(context, "shifts\.close"\)/);
});

test("database source retains the server-derived expected-cash and immutable shift lifecycle", () => {
  assert.match(shiftMigration, /difference_minor = target_counted_cash_minor - calculated_cash\.expected_cash_minor/);
  assert.match(shiftMigration, /Immutable register-shift lifecycle/);
  assert.match(shiftMigration, /cash_movements_select_authorized/);
});
