import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const pos = read("apps/mobile/app/(app)/pos.tsx");
const tender = read("apps/mobile/src/features/cashier/cashier-tender-panel.tsx");
const summary = read("apps/mobile/src/features/cashier/cashier-receipt-summary.tsx");
const localReceipt = read("apps/mobile/app/(app)/local-receipt/[eventId].tsx");
const onlineReceipt = read("apps/mobile/app/(app)/receipt/[receiptId].tsx");

test("Slice 11 presents one focused tender surface with explicit received and change values", () => {
  assert.match(pos, /<CashierTenderPanel/);
  for (const marker of [
    'testID="checkout-panel"',
    'testID="cash-tender-input"',
    'testID="save-offline-cash-sale"',
    'testID="complete-online-cash-checkout"',
    "Amount due",
    "Cash received",
    "Change due",
  ]) assert.ok(tender.includes(marker), `Missing tender marker ${marker}`);
  assert.match(tender, /online \? \([\s\S]*variant="secondary"[\s\S]*\) : \(/);
  assert.match(tender, /busy=\{savingOffline\}/);
  assert.match(tender, /busy=\{onlineCheckoutPending\}/);
  assert.match(tender, /disabled=\{offlineDisabled\}/);
  assert.match(tender, /disabled=\{onlineDisabled\}/);
});

test("Slice 11 prevents duplicate acceptance and preserves durable checkout identity", () => {
  assert.match(pos, /if \(onlineIntentLoading \|\| savingOffline\) return/);
  assert.match(pos, /onlineCheckoutPending[\s\S]*onlineIntentLoading/);
  assert.ok(pos.indexOf("prepareOnlineCheckoutIntent({") < pos.indexOf("checkoutPosV2("));
  assert.ok(pos.indexOf("markOnlineCheckoutIntentAcknowledged(") < pos.indexOf('kind: "official"'));
  assert.match(pos, /reference: result\.event\.localReference/);
  assert.match(pos, /totalMinor: result\.event\.snapshot\.totalMinor/);
  assert.match(pos, /changeMinor: result\.event\.snapshot\.changeMinor/);
  assert.match(pos, /replayed: result\.data\.wasReplayed/);
  assert.match(tender, /without creating a duplicate sale/);
  assert.match(tender, /durably accepted on this register/);
});

test("Slice 11 converges provisional and official receipt results without changing authority", () => {
  for (const label of ["Items", "Subtotal", "Discount", "Tax", "Total", "Payment", "Cash received", "Change"]) {
    assert.match(summary, new RegExp(label));
  }
  assert.match(summary, /status: "official" \| "provisional"/);
  assert.match(summary, /durable sale evidence, not an official receipt/);
  assert.match(localReceipt, /<CashierReceiptSummary/);
  assert.match(localReceipt, /receipt\.officialReceiptNumber === null \? "provisional" : "official"/);
  assert.match(localReceipt, /getLocalReceipt\(organizationId, storeIds, eventId\)/);
  assert.match(localReceipt, /prepareReceiptCopy/);
  assert.match(onlineReceipt, /<CashierReceiptSummary/);
  assert.match(onlineReceipt, /status="official"/);
  assert.match(onlineReceipt, /refundPosV2Receipt/);
  assert.match(onlineReceipt, /deliverPosV2Receipt/);
  for (const source of [tender, summary]) {
    assert.doesNotMatch(source, /checkoutPosV2|createOfflineCashSale|prepareOnlineCheckoutIntent|enqueueSaleCompletedEvent|DELETE FROM/);
  }
});
