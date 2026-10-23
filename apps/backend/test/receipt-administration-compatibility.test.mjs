import assert from "node:assert/strict";
import test from "node:test";

import {
  RECEIPT_ADMINISTRATION_COMPATIBILITY_CONTRACT,
  mapReceiptDeliveryRpcResult,
  mapReceiptSettingsRpcResult,
  toReceiptDeliveryRpcArguments,
  toReceiptSettingsRpcArguments,
  validateReceiptDelivery,
  validateReceiptSettings,
} from "../dist/src/pos/receipt-administration-compatibility.js";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const RECEIPT_ID = "10000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "20000000-0000-4000-8000-000000000001";
const DELIVERY_ID = "30000000-0000-4000-8000-000000000001";
const SETTINGS_PERMISSION = ["settings.manage"];
const DELIVERY_PERMISSION = ["receipts.reprint"];
const SETTINGS = {
  businessName: "Razzey Trading",
  businessAddress: "Main Street",
  businessPhone: "+63 900 000 0000",
  businessEmail: "Sales@Example.com",
  businessTaxId: "TIN-123",
  businessWebsite: "https://example.com",
  headerMessage: "Welcome",
  footerMessage: "Thank you",
  paperWidthMm: 80,
  showStoreAddress: true,
  showStorePhone: true,
  showCashier: true,
  showRegister: true,
  showPaymentDetails: true,
};
const DELIVERY = {
  receiptId: RECEIPT_ID,
  recipient: "Customer@Example.com",
  idempotencyKey: IDEMPOTENCY_KEY,
};
const DELIVERY_ROW = {
  delivery_request_id: DELIVERY_ID,
  delivery_status: "QUEUED",
  was_replayed: false,
};

test("receipt administration freezes Server Action authority, custody, effects, and revalidation", () => {
  const contract = RECEIPT_ADMINISTRATION_COMPATIBILITY_CONTRACT;
  assert.equal(contract.authority, "next-server-actions");
  assert.equal(contract.settingsEntryPoint, "updateReceiptSettingsAction");
  assert.equal(contract.deliveryEntryPoint, "queueReceiptDeliveryAction");
  assert.equal(contract.settingsPermission, "settings.manage");
  assert.equal(contract.deliveryPermission, "receipts.reprint");
  assert.equal(contract.settingsRpc, "update_receipt_settings");
  assert.equal(contract.deliveryRpc, "queue_receipt_delivery");
  assert.equal(contract.deliveryChannel, "EMAIL");
  assert.match(contract.deliveryIdempotency, /organization-key-plus-actor/);
  assert.deepEqual(contract.revalidation, [
    "/back-office/receipt-settings",
    "/back-office/receipts",
    "/back-office/receipts/{receiptId}",
  ]);
});

test("receipt settings requires permission before validating input", () => {
  assert.deepEqual(validateReceiptSettings(null, { permissions: [] }), {
    ok: false,
    result: { ok: false, message: "You do not have permission to update receipt settings." },
  });
});

test("receipt settings trims bounded fields, strips extras, and rejects invalid layouts", () => {
  assert.deepEqual(
    validateReceiptSettings({ ...SETTINGS, businessName: "  Razzey Trading  ", ignored: true }, { permissions: SETTINGS_PERMISSION }),
    { ok: true, input: SETTINGS },
  );
  for (const value of [
    null,
    { ...SETTINGS, businessName: "x" },
    { ...SETTINGS, businessEmail: "invalid" },
    { ...SETTINGS, footerMessage: "x" },
    { ...SETTINGS, paperWidthMm: 76 },
    { ...SETTINGS, showCashier: "yes" },
  ]) {
    assert.deepEqual(validateReceiptSettings(value, { permissions: SETTINGS_PERMISSION }), {
      ok: false,
      result: { ok: false, message: "Check the receipt business information and layout values." },
    });
  }
});

test("receipt settings maps the exact RPC projection", () => {
  assert.deepEqual(toReceiptSettingsRpcArguments(ORGANIZATION_ID, SETTINGS), {
    target_organization_id: ORGANIZATION_ID,
    target_business_name: "Razzey Trading",
    target_business_address: "Main Street",
    target_business_phone: "+63 900 000 0000",
    target_business_email: "Sales@Example.com",
    target_business_tax_id: "TIN-123",
    target_business_website: "https://example.com",
    target_header_message: "Welcome",
    target_footer_message: "Thank you",
    target_paper_width_mm: 80,
    target_show_store_address: true,
    target_show_store_phone: true,
    target_show_cashier: true,
    target_show_register: true,
    target_show_payment_details: true,
  });
});

test("receipt settings maps database failures and success exactly", () => {
  assert.deepEqual(mapReceiptSettingsRpcResult(null, { code: "42501", message: "private" }), {
    ok: false, message: "You do not have permission to perform this receipt action.",
  });
  assert.deepEqual(mapReceiptSettingsRpcResult(null, { code: "23514", message: "Database business rule." }), {
    ok: false, message: "Database business rule.",
  });
  for (const [data, error] of [[null, null], [null, { code: "XX000", message: "private" }]]) {
    assert.deepEqual(mapReceiptSettingsRpcResult(data, error), {
      ok: false, message: "TINDIO could not save the receipt settings.",
    });
  }
  assert.deepEqual(mapReceiptSettingsRpcResult(true, null), {
    ok: true,
    message: "Receipt settings saved. New receipts will preserve this layout; existing receipts stay unchanged.",
  });
});

test("digital delivery requires permission before validating input", () => {
  assert.deepEqual(validateReceiptDelivery(null, { permissions: [] }), {
    ok: false,
    result: { ok: false, message: "You do not have permission to queue a digital receipt." },
  });
});

test("digital delivery trims valid recipients, strips extras, and rejects invalid identities", () => {
  assert.deepEqual(
    validateReceiptDelivery({ ...DELIVERY, recipient: "  Customer@Example.com  ", ignored: true }, { permissions: DELIVERY_PERMISSION }),
    { ok: true, input: DELIVERY },
  );
  for (const value of [
    null,
    { ...DELIVERY, receiptId: "bad" },
    { ...DELIVERY, recipient: "bad" },
    { ...DELIVERY, recipient: `${"a".repeat(310)}@example.com` },
    { ...DELIVERY, idempotencyKey: "bad" },
  ]) {
    assert.deepEqual(validateReceiptDelivery(value, { permissions: DELIVERY_PERMISSION }), {
      ok: false,
      result: { ok: false, message: "Enter a valid recipient email address." },
    });
  }
});

test("digital delivery maps the exact EMAIL RPC projection", () => {
  assert.deepEqual(toReceiptDeliveryRpcArguments(ORGANIZATION_ID, DELIVERY), {
    target_organization_id: ORGANIZATION_ID,
    target_receipt_id: RECEIPT_ID,
    target_delivery_channel: "EMAIL",
    target_recipient: "Customer@Example.com",
    target_idempotency_key: IDEMPOTENCY_KEY,
  });
});

test("digital delivery maps database failures without leaking unapproved detail", () => {
  assert.deepEqual(mapReceiptDeliveryRpcResult(null, { code: "42501", message: "private" }), {
    ok: false, message: "You do not have permission to perform this receipt action.",
  });
  assert.deepEqual(mapReceiptDeliveryRpcResult(null, { code: "23505" }), {
    ok: false, message: "This action was already recorded for a different request.",
  });
  assert.deepEqual(mapReceiptDeliveryRpcResult(null, { code: "23505", message: "Delivery key conflict." }), {
    ok: false, message: "Delivery key conflict.",
  });
  assert.deepEqual(mapReceiptDeliveryRpcResult(null, { code: "23514", message: "Invalid delivery." }), {
    ok: false, message: "Invalid delivery.",
  });
  assert.deepEqual(mapReceiptDeliveryRpcResult(null, { code: "XX000", message: "private" }), {
    ok: false, message: "TINDIO could not queue this digital receipt.",
  });
});

test("digital delivery maps new and replayed success messages exactly", () => {
  assert.deepEqual(mapReceiptDeliveryRpcResult([DELIVERY_ROW], null), {
    ok: true, message: "Digital receipt request queued securely.",
  });
  assert.deepEqual(mapReceiptDeliveryRpcResult([{ ...DELIVERY_ROW, was_replayed: true }], null), {
    ok: true, message: "This digital receipt request was already queued.",
  });
});
