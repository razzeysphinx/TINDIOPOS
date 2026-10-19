import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("shared receipt contracts retain their wire fields and payment discriminants", async () => {
  const contract = await read("packages/contracts/src/receipts.ts");

  for (const field of [
    "receipt_id",
    "sale_id",
    "receipt_number",
    "refund_total_minor",
    "has_refundable_quantity",
    "organizationName",
    "unitPriceMinor",
    "lineTotalMinor",
    "referenceNumber",
    "paymentReference",
    "hasMore",
  ]) {
    assert.match(contract, new RegExp(`\\b${field}\\b`));
  }

  for (const paymentType of [
    "CASH",
    "CARD",
    "E_WALLET",
    "BANK_TRANSFER",
    "VOUCHER",
    "OTHER",
  ]) {
    assert.match(contract, new RegExp(`"${paymentType}"`));
  }

  assert.match(contract, /\{ \[key: string\]: JsonValue \| undefined \}/);
  assert.match(contract, /layout:\s*JsonValue \| null/);
  assert.doesNotMatch(
    contract,
    /next(?:\/|["'])|react-native|@supabase|@neon|database\.types|node:(?:fs|path)|process\.env/,
  );
});

test("shared attendance read contracts retain entry and response shapes", async () => {
  const contract = await read("packages/contracts/src/attendance.ts");

  for (const field of [
    "employeeId",
    "employeeName",
    "storeId",
    "storeName",
    "clockedInAt",
    "clockedOutAt",
    "employeeNumber",
    "pinIsSet",
    "entry",
    "employees",
  ]) {
    assert.match(contract, new RegExp(`\\b${field}\\b`));
  }

  assert.match(contract, /\{ ok: true; employees: AttendanceEmployee\[\] \}/);
  assert.match(contract, /\{ ok: false; message: string; employees: \[\] \}/);
  assert.doesNotMatch(
    contract,
    /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/,
  );
});

test("Web facades retain old paths while Mobile read consumers use the package", async () => {
  const [posFacade, timeClockFacade] = await Promise.all([
    read("src/contracts/pos.ts"),
    read("src/features/time-clock/time-clock-types.ts"),
  ]);

  for (const typeName of [
    "PosReceiptSummary",
    "PosReceiptDetail",
    "PosReceiptListResponse",
    "TimeClockEntry",
    "AttendanceEmployee",
    "AttendanceEmployeesResult",
  ]) {
    assert.match(posFacade, new RegExp(`\\b${typeName}\\b`));
    assert.doesNotMatch(posFacade, new RegExp(`export type ${typeName}\\s*=`));
  }

  assert.match(timeClockFacade, /from ["']@tindio\/contracts["']/);
  assert.doesNotMatch(timeClockFacade, /export type (?:TimeClockEntry|AttendanceEmployee|AttendanceEmployeesResult)\s*=/);
  assert.match(timeClockFacade, /export type TimeClockActionResult\s*=/);
  assert.match(posFacade, /from ["']@\/features\/receipts\/refund-schema["']/);

  const mobileSources = await Promise.all([
    read("apps/mobile/app/(app)/receipts.tsx"),
    read("apps/mobile/app/(app)/receipt/[receiptId].tsx"),
    read("apps/mobile/app/(app)/time-clock.tsx"),
    read("apps/mobile/src/db/receipt-cache.ts"),
  ]);
  for (const source of mobileSources) {
    assert.match(source, /from ["']@tindio\/contracts["']/);
    assert.doesNotMatch(source, /src\/contracts\/pos|src\/features\/time-clock\/time-clock-types/);
  }
});
