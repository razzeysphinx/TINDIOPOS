import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("shared checkout contracts retain financial input and result fields", async () => {
  const contract = await read("packages/contracts/src/checkout.ts");

  for (const field of [
    "idempotencyKey",
    "loyaltyRedemptionPoints",
    "offlineExpectedTotalMinor",
    "unitPriceMinor",
    "modifierOptionIds",
    "tenderedAmount",
    "receiptNumber",
    "totalMinor",
    "changeMinor",
    "wasReplayed",
    "inventoryWarning",
    "serverCheckpoint",
    "expectedSequence",
  ]) {
    assert.match(contract, new RegExp(`\\b${field}\\b`));
  }

  for (const value of [
    "DUPLICATE_TRANSACTION",
    "PRICE_CHANGED",
    "INVENTORY_CONFLICT",
    "REGISTER_REVOKED",
    "DEVICE_REVOKED",
    "SEQUENCE_GAP",
    "SEQUENCE_CONFLICT",
    "SEQUENCE_OUT_OF_ORDER",
    "IDEMPOTENCY_SEQUENCE_MISMATCH",
  ]) {
    assert.match(contract, new RegExp(`"${value}"`));
  }

  assert.doesNotMatch(
    contract,
    /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/,
  );
});

test("shared sync-push contracts retain ordered acknowledgement envelopes", async () => {
  const contract = await read("packages/contracts/src/sync-push.ts");

  assert.match(contract, /operationType:\s*"SALE_COMPLETED"/);
  assert.match(contract, /deviceSequence:\s*number/);
  assert.match(contract, /status:\s*"SYNCED" \| "RETRY" \| "CONFLICT" \| "FAILED"/);
  assert.match(contract, /httpStatus:\s*number/);
  assert.match(contract, /result:\s*CheckoutSaleActionResult/);
  assert.match(contract, /version:\s*1/);
  assert.match(contract, /acks:\s*PosSyncPushAck\[\]/);
  assert.match(contract, /stoppedEarly:\s*boolean/);
});

test("Web checkout and root POS paths remain compatibility facades", async () => {
  const [schema, checkoutTypes, posFacade] = await Promise.all([
    read("src/features/checkout/checkout-schema.ts"),
    read("src/features/checkout/checkout-types.ts"),
    read("src/contracts/pos.ts"),
  ]);

  assert.match(schema, /satisfies z\.ZodType<CheckoutSaleValues>/);
  assert.match(schema, /export type \{ CheckoutSaleValues \} from ["']@tindio\/contracts["']/);
  assert.match(checkoutTypes, /CheckoutSaleActionResult,[\s\S]*CheckoutSequenceInfo,[\s\S]*from ["']@tindio\/contracts["']/);
  for (const typeName of ["PosSyncPushEvent", "PosSyncPushAck", "PosSyncPushResponse"]) {
    assert.match(posFacade, new RegExp(`\\b${typeName}\\b`));
    assert.doesNotMatch(posFacade, new RegExp(`export type ${typeName}\\s*=`));
  }
});

test("Mobile checkout and sync-push consumers use the shared package", async () => {
  const paths = [
    "apps/mobile/app/(app)/pos.tsx",
    "apps/mobile/src/db/checkout-intents.ts",
    "apps/mobile/src/features/outbox/outbox-types.ts",
    "apps/mobile/src/features/outbox/outbox-sync.ts",
    "apps/mobile/src/features/outbox/sync-policy.ts",
    "apps/mobile/src/lib/tindio-api.ts",
  ];
  const forbiddenTypes = /CheckoutSaleActionResult|CheckoutSaleValues|PosSyncPushAck|PosSyncPushEvent|PosSyncPushResponse/;

  for (const source of await Promise.all(paths.map(read))) {
    assert.match(source, /from ["']@tindio\/contracts["']/);
    const rootImports = [...source.matchAll(/import type \{[\s\S]*?\} from ["']([^"']+)["'];/g)]
      .filter((match) => match[1].includes("src/contracts/pos") || match[1].includes("src/features/checkout"))
      .map((match) => match[0])
      .join("\n");
    assert.doesNotMatch(rootImports, forbiddenTypes);
  }
});
