import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFLINE_CHECKOUT_COMPATIBILITY_CONTRACT,
  mapOfflineSequenceFinalization,
  mapOfflineSequenceReservation,
  offlineCheckoutFailureCode,
  offlineCheckoutResponseStatus,
  offlineSequenceFinalState,
  offlineSequenceIntent,
  shouldRecordOfflineOutcome,
  toOfflineCheckoutRpcArguments,
  toOfflineRecordArguments,
  toOfflineSequenceReservationArguments,
  validateOfflineCheckout,
  validateOfflineDeviceBinding,
  validateOfflinePaymentMethod,
} from "../dist/src/pos/offline-checkout-compatibility.js";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const STORE_ID = "10000000-0000-4000-8000-000000000001";
const REGISTER_ID = "20000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "30000000-0000-4000-8000-000000000001";
const PAYMENT_METHOD_ID = "40000000-0000-4000-8000-000000000001";
const DEVICE_ID = "50000000-0000-4000-8000-000000000001";
const SHIFT_ID = "60000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "70000000-0000-4000-8000-000000000001";
const SALE_ID = "80000000-0000-4000-8000-000000000001";

const CONTEXT = {
  permissions: ["pos.access", "sales.create", "payments.accept"],
  assignedStoreIds: [STORE_ID],
};

const CHECKOUT = {
  storeId: STORE_ID,
  registerId: REGISTER_ID,
  idempotencyKey: IDEMPOTENCY_KEY,
  customerId: null,
  loyaltyRedemptionPoints: 0,
  discountId: null,
  taxRateId: null,
  diningOptionId: null,
  openTicketId: null,
  offlineExpectedTotalMinor: 1500,
  items: [{
    productId: PRODUCT_ID,
    variantId: null,
    quantity: 1,
    unitPriceMinor: 1500,
    modifierOptionIds: [],
    itemNote: null,
  }],
  payments: [{
    paymentMethodId: PAYMENT_METHOD_ID,
    tenderedAmount: "20.00",
    referenceNumber: "",
    note: "local cash",
  }],
};

const DEVICE = {
  deviceId: DEVICE_ID,
  secret: "a".repeat(64),
  appVersion: "mobile-1.0.0",
};

const OFFLINE = {
  localReceiptReference: "OFF-ABC123",
  createdAt: "2026-10-21T08:00:00.000Z",
  shiftId: SHIFT_ID,
  deviceId: DEVICE_ID,
  deviceSequence: 7,
};

const WRAPPED = { checkout: CHECKOUT, device: DEVICE, offline: OFFLINE };
const SUCCESS = {
  ok: true,
  message: "Sale complete.",
  data: {
    saleId: SALE_ID,
    receiptNumber: 42,
    totalMinor: 1500,
    changeMinor: 500,
    payments: [],
    wasReplayed: false,
    inventoryWarning: null,
  },
};

test("offline checkout freezes route, sequencing, settlement, recording, and responses", () => {
  assert.deepEqual(OFFLINE_CHECKOUT_COMPATIBILITY_CONTRACT, {
    method: "POST",
    path: "/api/pos/v2/offline-checkout",
    authentication: "supabase-business-context-before-json",
    organizationScope: "selected-header-or-authorized-default",
    requestOrder: "business-context-before-json-before-sequence-before-checkout",
    acceptedBodies: [
      "wrapped-checkout-device-optional-offline",
      "legacy-bare-checkout",
    ],
    sequenceModes: ["sequenced", "legacy-unsequenced"],
    deviceRpc: "validate_pos_device",
    reserveRpc: "reserve_pos_device_sequence",
    checkoutRpc: "checkout_advanced_sale",
    finalizeRpc: "finalize_pos_device_sequence",
    recordRpc: "record_offline_sync_event",
    sequenceStatuses: [
      "ACCEPTED", "REPLAY", "GAP", "DUPLICATE_SEQUENCE", "OUT_OF_ORDER",
      "IDEMPOTENCY_SEQUENCE_MISMATCH",
    ],
    checkoutGuard: "required-original-total-marker",
    paymentGuard: "exactly-one-cash-tender-with-offline-policy-cash",
    finalization: {
      success: "APPLIED",
      terminalFailure: "CONFLICT",
      retryableFailure: "leave-RECEIVED",
    },
    recording: "wrapped-offline-terminal-outcomes-only",
    actionResponses: {
      success: 200,
      conflict: 409,
      deviceRejected: 403,
      malformedJson: 400,
      retryable: 503,
      headers: { "cache-control": "private, no-store" },
    },
    malformedJsonMessage: "The queued sale data is invalid.",
    unconfirmedMessage: "TINDIO could not confirm this queued sale. It will remain queued for review.",
  });
});

test("offline checkout accepts normalized wrapped and legacy forms", () => {
  const wrapped = validateOfflineCheckout({
    ...WRAPPED,
    checkout: { ...CHECKOUT, ignored: "strip" },
    device: { ...DEVICE, appVersion: " mobile-1.0.0 " },
  }, CONTEXT);
  assert.equal(wrapped.ok, true);
  assert.equal(wrapped.bodyShape, "wrapped");
  assert.equal(wrapped.device.appVersion, "mobile-1.0.0");
  assert.equal(wrapped.offline.deviceSequence, 7);
  assert.equal(wrapped.offlineTotalMarker, "[tindio-offline-total:1500]");

  const legacy = validateOfflineCheckout(CHECKOUT, CONTEXT);
  assert.equal(legacy.ok, true);
  assert.equal(legacy.bodyShape, "legacy");
  assert.equal(legacy.offline, undefined);
});

test("offline checkout preserves total, note, and one-tender guards", () => {
  const cases = [
    [{ ...CHECKOUT, offlineExpectedTotalMinor: undefined }, "The queued sale is missing its original total and needs review.", "DUPLICATE_TRANSACTION"],
    [{ ...CHECKOUT, payments: [{ ...CHECKOUT.payments[0], note: "x".repeat(480) }] }, "This queued sale note is too long to sync safely and needs review.", undefined],
    [{ ...CHECKOUT, payments: [{ ...CHECKOUT.payments[0], tenderedAmount: undefined, amount: "15.00" }] }, "Offline settlement requires one cached cash payment.", "PERMISSION_CHANGED"],
  ];
  for (const [checkout, message, failureCode] of cases) {
    const result = validateOfflineCheckout(checkout, CONTEXT);
    assert.equal(result.ok, false);
    assert.equal(result.result.message, message);
    assert.equal(result.result.failureCode, failureCode);
  }
});

test("offline checkout freezes payment-method cash policy and RPC total marker", () => {
  assert.equal(validateOfflinePaymentMethod({ payment_type: "CASH", offline_policy: "cash" }, null), null);
  for (const [method, error] of [
    [{ payment_type: "CARD", offline_policy: "disabled" }, null],
    [null, { code: "provider" }],
  ]) {
    assert.deepEqual(validateOfflinePaymentMethod(method, error), {
      ok: false,
      message: "This payment method no longer permits automatic offline cash settlement.",
      retryable: false,
      failureCode: "PERMISSION_CHANGED",
    });
  }
  const args = toOfflineCheckoutRpcArguments(ORGANIZATION_ID, CHECKOUT);
  assert.equal(args.target_organization_id, ORGANIZATION_ID);
  assert.equal(args.target_payments[0].amount_tendered_minor, 2000);
  assert.equal(args.target_payments[0].note, "local cash [tindio-offline-total:1500]");
});

test("offline sequence remains optional but binds sequenced requests to explicit device identity", () => {
  assert.deepEqual(offlineSequenceIntent(CHECKOUT), { kind: "none" });
  assert.deepEqual(offlineSequenceIntent({ ...WRAPPED, offline: { ...OFFLINE, deviceSequence: undefined } }), { kind: "none" });
  const rejected = offlineSequenceIntent({ ...WRAPPED, offline: { ...OFFLINE, deviceId: SHIFT_ID } });
  assert.equal(rejected.kind, "rejected");
  assert.equal(rejected.status, 409);
  assert.equal(rejected.result.failureCode, "SEQUENCE_CONFLICT");

  const required = offlineSequenceIntent(WRAPPED);
  assert.equal(required.kind, "required");
  assert.deepEqual(toOfflineSequenceReservationArguments(ORGANIZATION_ID, required), {
    target_organization_id: ORGANIZATION_ID,
    target_device_id: DEVICE_ID,
    target_store_id: STORE_ID,
    target_register_id: REGISTER_ID,
    target_device_sequence: 7,
    target_idempotency_key: IDEMPOTENCY_KEY,
    target_local_receipt_reference: "OFF-ABC123",
  });
});

test("offline device validation binds device, store, and register", () => {
  const intent = offlineSequenceIntent(WRAPPED);
  assert.equal(intent.kind, "required");
  const valid = [{ device_id: DEVICE_ID, store_id: STORE_ID, register_id: REGISTER_ID }];
  assert.equal(validateOfflineDeviceBinding(valid, null, intent), null);
  for (const [value, error] of [
    [[{ device_id: DEVICE_ID, store_id: SHIFT_ID, register_id: REGISTER_ID }], null],
    [null, { code: "42501" }],
  ]) {
    assert.deepEqual(validateOfflineDeviceBinding(value, error, intent), {
      ok: false,
      retryable: false,
      failureCode: "DEVICE_REVOKED",
      message: "This POS device is not active for the saved sale terminal.",
    });
  }
});

test("offline sequence reservation preserves accept, replay, gap, duplicate, and retry semantics", () => {
  for (const status of ["ACCEPTED", "REPLAY"]) {
    const result = mapOfflineSequenceReservation([{
      status,
      server_checkpoint: 6,
      expected_sequence: 7,
    }], null, 7);
    assert.equal(result.kind, "reserved");
    assert.equal(result.sync.status, status);
  }
  for (const [status, failureCode] of [
    ["GAP", "SEQUENCE_GAP"],
    ["OUT_OF_ORDER", "SEQUENCE_OUT_OF_ORDER"],
    ["DUPLICATE_SEQUENCE", "SEQUENCE_CONFLICT"],
    ["IDEMPOTENCY_SEQUENCE_MISMATCH", "SEQUENCE_CONFLICT"],
  ]) {
    const result = mapOfflineSequenceReservation([{
      status,
      server_checkpoint: 6,
      expected_sequence: 7,
    }], null, 7);
    assert.equal(result.kind, "rejected");
    assert.equal(result.status, 409);
    assert.equal(result.result.failureCode, failureCode);
  }
  assert.equal(mapOfflineSequenceReservation(null, { code: "provider" }, 7).kind, "retryable");
});

test("offline checkout classifies deterministic database conflicts", () => {
  for (const [code, message, expected] of [
    ["23505", "detail", "DUPLICATE_TRANSACTION"],
    ["42501", "device is revoked", "DEVICE_REVOKED"],
    ["42501", "register is revoked", "REGISTER_REVOKED"],
    ["42501", "shift is invalid", "INVALID_SHIFT"],
    ["23514", "Queued sale total changed", "PRICE_CHANGED"],
    ["23514", "Tax changed", "TAX_CHANGED"],
    ["23514", "Customer invalid", "CUSTOMER_INVALID"],
    ["23514", "Stock unavailable", "INVENTORY_CONFLICT"],
    ["23514", "Product archived", "PRODUCT_ARCHIVED"],
    ["23514", "Shift closed", "CLOSED_SHIFT"],
  ]) assert.equal(offlineCheckoutFailureCode(code, message), expected);
});

test("offline sequence finalizes terminal outcomes and leaves retryable work received", () => {
  const conflict = { ok: false, message: "conflict", retryable: false };
  const retry = { ok: false, message: "retry", retryable: true };
  assert.equal(offlineSequenceFinalState(SUCCESS), "APPLIED");
  assert.equal(offlineSequenceFinalState(conflict), "CONFLICT");
  assert.equal(offlineSequenceFinalState(retry), null);

  const sync = { deviceSequence: 7, serverCheckpoint: 6, expectedSequence: 7, status: "ACCEPTED" };
  assert.deepEqual(mapOfflineSequenceFinalization(sync, [{ server_checkpoint: 7 }], null), {
    ...sync,
    serverCheckpoint: 7,
    expectedSequence: 8,
  });
  assert.deepEqual(mapOfflineSequenceFinalization(sync, null, { code: "provider" }), {
    ok: false,
    message: "TINDIO accepted the sale but could not finalize its sequence checkpoint. Retry this same saved sale.",
    retryable: true,
  });
});

test("offline outcomes record only terminal wrapped metadata and map exact status", () => {
  const conflict = {
    ok: false,
    message: "sequence conflict",
    retryable: false,
    failureCode: "SEQUENCE_GAP",
  };
  assert.equal(shouldRecordOfflineOutcome(WRAPPED, SUCCESS), true);
  assert.equal(shouldRecordOfflineOutcome(WRAPPED, conflict), true);
  assert.equal(shouldRecordOfflineOutcome(WRAPPED, { ...conflict, retryable: true }), false);
  assert.equal(shouldRecordOfflineOutcome(CHECKOUT, SUCCESS), false);
  assert.equal(offlineCheckoutResponseStatus(SUCCESS), 200);
  assert.equal(offlineCheckoutResponseStatus(conflict), 409);
  assert.equal(offlineCheckoutResponseStatus({ ...conflict, retryable: true }), 503);

  assert.deepEqual(toOfflineRecordArguments(ORGANIZATION_ID, WRAPPED, conflict), {
    target_organization_id: ORGANIZATION_ID,
    target_store_id: STORE_ID,
    target_register_id: REGISTER_ID,
    target_shift_id: SHIFT_ID,
    target_device_id: DEVICE_ID,
    target_idempotency_key: IDEMPOTENCY_KEY,
    target_local_receipt_reference: "OFF-ABC123",
    target_local_created_at: "2026-10-21T08:00:00.000Z",
    target_state: "CONFLICT",
    target_conflict_type: "PERMISSION_CHANGED",
    target_failure_message: "sequence conflict",
    target_official_receipt_number: null,
  });
  assert.equal(
    toOfflineRecordArguments(ORGANIZATION_ID, WRAPPED, SUCCESS).target_official_receipt_number,
    42,
  );
});
