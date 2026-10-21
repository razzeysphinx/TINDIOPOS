import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

async function sourceFiles(path) {
  const entries = await readdir(new URL(path, root), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await sourceFiles(child));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(child);
  }
  return files;
}

test("shared stock-validation contracts retain values, policy, and projections", async () => {
  const contract = await read("packages/contracts/src/checkout.ts");

  assert.match(contract, /export type ValidateCartStockValues/);
  assert.match(contract, /storeId:\s*string/);
  assert.match(contract, /registerId:\s*string/);
  assert.match(contract, /quantity:\s*number/);
  assert.match(contract, /export type NegativeStockPolicy = "allow" \| "warn" \| "block"/);
  for (const field of [
    "availableQuantity",
    "cartQuantity",
    "projectedQuantity",
    "checkedAt",
  ]) {
    assert.match(contract, new RegExp(`\\b${field}\\b`));
  }
  assert.match(contract, /export type ValidateCartStockActionResult/);
});

test("shared ticket and time-clock results retain their discriminated shapes", async () => {
  const [operations, attendance] = await Promise.all([
    read("packages/contracts/src/pos-operations.ts"),
    read("packages/contracts/src/attendance.ts"),
  ]);

  assert.match(operations, /export type TicketActionResult/);
  assert.match(operations, /ticketId:\s*string/);
  assert.match(operations, /export type TicketMutationResult/);
  assert.match(attendance, /export type TimeClockActionResult/);
  assert.match(attendance, /entry:\s*TimeClockEntry/);
  assert.match(attendance, /openShift\?:\s*\{/);
  assert.match(attendance, /registerName:\s*string/);
  assert.doesNotMatch(
    `${operations}\n${attendance}`,
    /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/,
  );
});

test("Web schemas and result modules remain compatibility facades", async () => {
  const [checkoutContract, checkoutSchema, checkoutTypes, ticketSchema, timeClockTypes, posFacade] = await Promise.all([
    read("packages/contracts/src/checkout.ts"),
    read("src/features/checkout/checkout-schema.ts"),
    read("src/features/checkout/checkout-types.ts"),
    read("src/features/advanced-sales/ticket-schema.ts"),
    read("src/features/time-clock/time-clock-types.ts"),
    read("src/contracts/pos.ts"),
  ]);

  assert.match(checkoutContract, /satisfies z\.ZodType<ValidateCartStockValues>/);
  assert.match(checkoutSchema, /validateCartStockSchema,[\s\S]*from ["']@tindio\/contracts\/checkout["']/);
  assert.match(checkoutSchema, /ValidateCartStockValues,[\s\S]*from ["']@tindio\/contracts\/checkout["']/);
  assert.match(checkoutTypes, /ValidateCartStockActionResult,[\s\S]*from ["']@tindio\/contracts["']/);
  assert.match(ticketSchema, /TicketActionResult,[\s\S]*TicketMutationResult,[\s\S]*from ["']@tindio\/contracts["']/);
  assert.match(timeClockTypes, /TimeClockActionResult,[\s\S]*from ["']@tindio\/contracts["']/);

  for (const typeName of [
    "TicketActionResult",
    "TicketMutationResult",
    "TimeClockActionResult",
    "ValidateCartStockActionResult",
    "ValidateCartStockValues",
  ]) {
    assert.match(posFacade, new RegExp(`\\b${typeName}\\b`));
    assert.doesNotMatch(posFacade, new RegExp(`export type ${typeName}\\s*=`));
  }
});

test("Mobile has no remaining root POS or Web checkout contract imports", async () => {
  const files = [
    ...await sourceFiles("apps/mobile/app"),
    ...await sourceFiles("apps/mobile/src"),
  ];
  const sources = await Promise.all(files.map(async (path) => ({ path, source: await read(path) })));
  const violations = sources
    .filter(({ source }) => /src\/contracts\/pos|src\/features\/checkout\/(?:checkout-schema|checkout-types)/.test(source.replaceAll("\\", "/")))
    .map(({ path }) => path);

  assert.deepEqual(violations, []);

  for (const path of [
    "apps/mobile/src/db/stock-estimate-cache.ts",
    "apps/mobile/src/features/local-first/local-stock.ts",
    "apps/mobile/src/lib/tindio-api.ts",
  ]) {
    assert.match(await read(path), /from ["']@tindio\/contracts["']/);
  }
});
