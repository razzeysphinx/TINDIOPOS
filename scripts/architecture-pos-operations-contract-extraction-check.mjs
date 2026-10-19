import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("shared operational read models retain their fields and shift discriminants", async () => {
  const contract = await read("packages/contracts/src/pos-operations.ts");

  for (const field of [
    "storeId",
    "registerId",
    "openingCashMinor",
    "openedAt",
    "customer",
    "diningOptionId",
    "assignedEmployeeId",
    "cart",
    "updatedAt",
    "fullName",
    "expectedCashMinor",
    "countedCashMinor",
    "differenceMinor",
  ]) {
    assert.match(contract, new RegExp(`\\b${field}\\b`));
  }

  assert.match(contract, /code:\s*"POS_CLIENT_UPGRADE_REQUIRED"/);
  assert.match(contract, /requiredCapability:\s*"SHIFT_CUSTODY_FINALIZATION_V1"/);
  assert.match(contract, /retryable:\s*false/);
  assert.match(contract, /preservesRecovery:\s*true/);
  assert.doesNotMatch(
    contract,
    /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/,
  );
});

test("Web operational facades preserve their existing import paths", async () => {
  const [posFacade, posTypesFacade] = await Promise.all([
    read("src/contracts/pos.ts"),
    read("src/features/pos/pos-types.ts"),
  ]);

  for (const typeName of [
    "PosStore",
    "PosRegister",
    "PosActiveShift",
    "PosOpenTicket",
    "PosTicketAssignee",
    "PosOpenShiftV2Response",
    "PosClientUpgradeRequiredResponse",
    "PosCloseShiftV2Response",
  ]) {
    assert.match(posFacade, new RegExp(`\\b${typeName}\\b`));
    assert.doesNotMatch(posFacade, new RegExp(`export type ${typeName}\\s*=`));
  }

  assert.match(posTypesFacade, /PosActiveShift/);
  assert.match(posTypesFacade, /PosOpenTicket/);
  assert.match(posTypesFacade, /from ["']@tindio\/contracts["']/);
  assert.doesNotMatch(posTypesFacade, /export type Pos(?:Store|Register|ActiveShift|OpenTicket|TicketAssignee)\s*=/);
  assert.match(posFacade, /from ["']@\/features\/advanced-sales\/ticket-schema["']/);
});

test("Mobile operational read-model consumers use the package", async () => {
  const sources = await Promise.all([
    read("apps/mobile/app/(app)/tickets.tsx"),
    read("apps/mobile/src/db/shift-cache.ts"),
  ]);

  for (const source of sources) {
    assert.match(source, /from ["']@tindio\/contracts["']/);
    assert.doesNotMatch(source, /src\/contracts\/pos|src\/features\/pos\/pos-types/);
  }

  const [posScreen, api] = await Promise.all([
    read("apps/mobile/app/(app)/pos.tsx"),
    read("apps/mobile/src/lib/tindio-api.ts"),
  ]);
  assert.match(posScreen, /PosOpenTicket,[\s\S]*from ["']@tindio\/contracts["']/);
  assert.match(api, /PosCloseShiftV2Response,[\s\S]*PosOpenShiftV2Response,[\s\S]*from ["']@tindio\/contracts["']/);
});
