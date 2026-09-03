import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

const [backOfficeList, backOfficeDetail, backOfficeQuickView, posList, posDetail, refundForm, refundAction, statusRpc, refundDatabaseTest] = await Promise.all([
  source("src/app/(back-office)/back-office/receipts/page.tsx"),
  source("src/app/(back-office)/back-office/receipts/[receiptId]/page.tsx"),
  source("src/features/receipts/receipt-list-quick-view.tsx"),
  source("src/app/(pos)/pos/receipts/page.tsx"),
  source("src/app/(pos)/pos/receipts/[receiptId]/page.tsx"),
  source("src/features/receipts/refund-form.tsx"),
  source("src/features/receipts/actions.ts"),
  source("supabase/migrations/20260831150856_pos_receipt_refund_status.sql"),
  source("supabase/tests/database/phase_5_receipts_refunds.test.sql"),
]);

assert.doesNotMatch(backOfficeList, /ReceiptRefundActions/, "Back Office refund entry must not clutter every receipt row");
assert.match(backOfficeQuickView, /\?refund=1#refund/, "The Back Office drawer must retain the canonical refund form route");
assert.match(backOfficeQuickView, /\/back-office\/receipts\/\$\{detail\.receipt\.id\}/, "The Back Office drawer must retain the existing receipt route");

assert.match(posList, /ReceiptRefundActions/, "POS receipt list must retain its shared receipt actions");
assert.match(posList, /\?refund=1#refund/, "POS receipt list must open the canonical refund form directly");
assert.match(posList, /\/pos\/receipts\/\$\{receipt\.receipt_id\}/, "POS receipt list must retain the existing receipt route");

assert.match(backOfficeList, /hasRefundableQuantityBySale/, "Back Office status must use refunded quantities, not totals alone");
assert.match(backOfficeList, /hasStoreAccess\(context, sale\.store_id\)/, "Back Office refund visibility must honor store scope");
assert.match(posList, /has_refundable_quantity/, "POS status must use the authoritative RPC quantity result");
assert.match(posList, /hasStoreAccess\(context, receipt\.store_id\)/, "POS refund visibility must honor store scope");

for (const [label, content] of [["Back Office detail", backOfficeDetail], ["POS detail", posDetail]]) {
  assert.match(content, /autoFocus=\{parameters\.refund === "1"\}/, `${label} must focus the canonical form after a direct refund action`);
  assert.match(content, /originalTotalMinor=/, `${label} must pass immutable receipt context to the shared form`);
}
assert.match(backOfficeDetail, /loadAuthorizedReceiptDetail\(/, "Back Office detail must use the canonical store-scoped receipt loader");
assert.match(posDetail, /hasStoreAccess\(/, "POS detail must preserve central store-scope checks");

assert.match(refundForm, /id="refund"/, "The canonical refund form must remain a direct-link target");
assert.match(refundForm, /Original receipt:/, "The refund form must identify the original receipt");
assert.match(refundForm, /Original total:/, "The refund form must identify the original total");
assert.match(refundForm, /const isBusy = isPending \|\| approvalRequestId !== null/, "Refund inputs must lock while the existing approval workflow is open");
assert.match(refundAction, /\.rpc\("refund_sale"/, "The direct flow must continue to use the canonical refund RPC");
assert.match(refundAction, /target_idempotency_key/, "The canonical refund RPC must retain idempotency");
assert.match(refundAction, /revalidatePath\("\/pos\/receipts"\)/, "A completed refund must refresh the POS list");

assert.match(statusRpc, /private\.has_permission\(target_organization_id, 'sales\.create'\)/, "The POS status RPC must keep its existing capability check");
assert.match(statusRpc, /public\.employee_stores/, "The POS status RPC must keep store-assignment enforcement");
assert.match(statusRpc, /has_refundable_quantity/, "The POS status RPC must return an item-quantity status");
assert.match(statusRpc, /revoke all on function public\.get_pos_receipt_history/, "The POS status RPC must keep least-privilege grants");
assert.doesNotMatch(statusRpc, /create table/i, "Receipt status must not duplicate refund records");
assert.match(refundDatabaseTest, /POS receipt history keeps a partially refunded receipt refundable/, "Database tests must cover partial refunds");
assert.match(refundDatabaseTest, /POS receipt history marks a fully returned receipt/, "Database tests must cover fully refunded receipts");

console.log("Receipt refund discoverability checks passed.");
