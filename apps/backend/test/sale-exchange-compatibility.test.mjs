import assert from "node:assert/strict";
import test from "node:test";

import {
  SALE_EXCHANGE_COMPATIBILITY_CONTRACT,
  mapSaleExchangeRpcResult,
  toSaleExchangeRpcArguments,
  validateSaleExchange,
} from "../dist/src/pos/sale-exchange-compatibility.js";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const REFUND_ID = "10000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "20000000-0000-4000-8000-000000000001";
const EXCHANGE_ID = "30000000-0000-4000-8000-000000000001";
const REPLACEMENT_SALE_ID = "40000000-0000-4000-8000-000000000001";
const PERMISSIONS = ["sales.refund", "sales.create"];
const VALID_INPUT = {
  refundId: REFUND_ID,
  replacementReceiptNumber: 42,
  idempotencyKey: IDEMPOTENCY_KEY,
};
const ROW = {
  exchange_id: EXCHANGE_ID,
  replacement_sale_id: REPLACEMENT_SALE_ID,
  replacement_receipt_number: 42,
  was_replayed: false,
};

test("sale exchange freezes Server Action authority, identities, replay, and immutable custody", () => {
  assert.equal(SALE_EXCHANGE_COMPATIBILITY_CONTRACT.authority, "next-server-action");
  assert.equal(SALE_EXCHANGE_COMPATIBILITY_CONTRACT.entryPoint, "linkSaleExchangeAction");
  assert.deepEqual(SALE_EXCHANGE_COMPATIBILITY_CONTRACT.permissions, PERMISSIONS);
  assert.equal(SALE_EXCHANGE_COMPATIBILITY_CONTRACT.rpc, "link_sale_exchange");
  assert.equal(SALE_EXCHANGE_COMPATIBILITY_CONTRACT.refundIdentity, "completed-refund-in-context-organization");
  assert.equal(SALE_EXCHANGE_COMPATIBILITY_CONTRACT.replacementIdentity, "completed-sale-derived-from-organization-receipt-number");
  assert.equal(SALE_EXCHANGE_COMPATIBILITY_CONTRACT.immutableCustody, "insert-link-only-source-sale-refund-and-replacement-sale-unchanged");
  assert.deepEqual(SALE_EXCHANGE_COMPATIBILITY_CONTRACT.revalidation, [
    "/back-office/receipts",
    "/back-office/receipts/[receiptId]:page",
  ]);
});

test("sale exchange requires both permissions before input validation", () => {
  for (const permissions of [[], ["sales.refund"], ["sales.create"]]) {
    assert.deepEqual(validateSaleExchange(null, { permissions }), {
      ok: false,
      result: { ok: false, message: "Sales and refund permission are required to record an exchange." },
    });
  }
});

test("sale exchange validates identities and receipt bounds while stripping extras", () => {
  assert.deepEqual(validateSaleExchange({ ...VALID_INPUT, ignored: true }, { permissions: PERMISSIONS }), {
    ok: true,
    input: VALID_INPUT,
  });
  for (const value of [
    null,
    { ...VALID_INPUT, refundId: "bad" },
    { ...VALID_INPUT, idempotencyKey: "bad" },
    { ...VALID_INPUT, replacementReceiptNumber: 0 },
    { ...VALID_INPUT, replacementReceiptNumber: 1.5 },
    { ...VALID_INPUT, replacementReceiptNumber: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    assert.deepEqual(validateSaleExchange(value, { permissions: PERMISSIONS }), {
      ok: false,
      result: { ok: false, message: "Choose a completed return and enter a valid replacement receipt number." },
    });
  }
});

test("sale exchange maps the exact RPC projection", () => {
  assert.deepEqual(toSaleExchangeRpcArguments(ORGANIZATION_ID, VALID_INPUT), {
    target_organization_id: ORGANIZATION_ID,
    target_refund_id: REFUND_ID,
    target_replacement_receipt_number: 42,
    target_idempotency_key: IDEMPOTENCY_KEY,
  });
});

test("sale exchange maps permission and provider failures without leaking detail", () => {
  assert.deepEqual(mapSaleExchangeRpcResult(null, { code: "42501", message: "private" }), {
    ok: false,
    message: "You do not have permission to perform this receipt action.",
  });
  assert.deepEqual(mapSaleExchangeRpcResult(null, { code: "XX000", message: "provider detail" }), {
    ok: false,
    message: "TINDIO could not link this return and replacement sale.",
  });
  assert.deepEqual(mapSaleExchangeRpcResult(null, null), {
    ok: false,
    message: "TINDIO could not link this return and replacement sale.",
  });
});

test("sale exchange preserves approved idempotency, constraint, and not-found detail", () => {
  assert.deepEqual(mapSaleExchangeRpcResult(null, { code: "23505", message: "Exchange key conflict." }), {
    ok: false,
    message: "Exchange key conflict.",
  });
  assert.deepEqual(mapSaleExchangeRpcResult(null, { code: "23505" }), {
    ok: false,
    message: "This action was already recorded for a different request.",
  });
  for (const code of ["23514", "P0002"]) {
    assert.deepEqual(mapSaleExchangeRpcResult(null, { code, message: "Database business rule." }), {
      ok: false,
      message: "Database business rule.",
    });
  }
});

test("sale exchange maps new and replayed success messages exactly", () => {
  assert.deepEqual(mapSaleExchangeRpcResult([ROW], null), {
    ok: true,
    message: "Exchange recorded: return linked to replacement receipt #42.",
  });
  assert.deepEqual(mapSaleExchangeRpcResult([{ ...ROW, was_replayed: true }], null), {
    ok: true,
    message: "This exchange is already linked to receipt #42.",
  });
});
