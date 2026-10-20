import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("shared customer-display session retains its transport fields", async () => {
  const contract = await read("packages/contracts/src/customer-display.ts");

  for (const field of ["sessionId", "registerId", "realtimeTopic"]) {
    assert.match(contract, new RegExp(`\\b${field}\\b`));
  }
  assert.doesNotMatch(
    contract,
    /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/,
  );
});

test("shared incoming-transfer projection retains status and quantity fields", async () => {
  const contract = await read("packages/contracts/src/transfers.ts");

  for (const value of ["dispatched", "partially_received"]) {
    assert.match(contract, new RegExp(`"${value}"`));
  }
  for (const field of [
    "transferNumber",
    "stockRequestId",
    "sourceStoreId",
    "sourceStoreName",
    "destinationStoreId",
    "destinationStoreName",
    "receivedQuantity",
    "shortQuantity",
  ]) {
    assert.match(contract, new RegExp(`\\b${field}\\b`));
  }

  assert.match(contract, /status is ReceivableTransferStatus/);
  assert.doesNotMatch(
    contract,
    /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/,
  );
});

test("feature facades retain old paths while Mobile transfer reads use the package", async () => {
  const [posFacade, posTypesFacade, displayFacade, transferFacade, mobileTransfer] = await Promise.all([
    read("src/contracts/pos.ts"),
    read("src/features/pos/pos-types.ts"),
    read("src/features/customer-display/customer-display-types.ts"),
    read("src/features/inventory/inventory-transfer-reader-contract.ts"),
    read("apps/mobile/app/(app)/transfers.tsx"),
  ]);

  for (const typeName of ["PosCustomerDisplaySession", "PosIncomingTransfer"]) {
    assert.match(posFacade, new RegExp(`\\b${typeName}\\b`));
    assert.doesNotMatch(posFacade, new RegExp(`export type ${typeName}\\s*=`));
  }
  assert.match(posTypesFacade, /PosIncomingTransfer/);
  assert.doesNotMatch(posTypesFacade, /export type PosIncomingTransfer\s*=/);
  assert.match(displayFacade, /from ["']@tindio\/contracts\/customer-display["']/);
  assert.match(displayFacade, /customerDisplayStateSchema/);
  assert.match(displayFacade, /customerDisplayUpdateSchema/);
  assert.match(displayFacade, /export type CustomerDisplayActionResult\s*=/);
  assert.match(transferFacade, /from ["']@tindio\/contracts["']/);
  assert.doesNotMatch(transferFacade, /export type ReceivableTransferStatus\s*=/);
  assert.match(mobileTransfer, /from ["']@tindio\/contracts["']/);
  assert.doesNotMatch(mobileTransfer, /src\/contracts\/pos|src\/features\/pos\/pos-types/);
});
