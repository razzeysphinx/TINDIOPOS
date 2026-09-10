import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

const [posPage, posHistory, posSearch, refundForm, refundAction, approvalDialog, approvalActions, securityPage, receiptMigration, refundDatabaseTest] = await Promise.all([
  source("src/app/(pos)/pos/receipts/page.tsx"),
  source("src/features/pos/pos-receipt-history.tsx"),
  source("src/features/pos/pos-receipt-search.tsx"),
  source("src/features/receipts/refund-form.tsx"),
  source("src/features/receipts/actions.ts"),
  source("src/features/approvals/manager-approval-dialog.tsx"),
  source("src/features/approvals/actions.ts"),
  source("src/app/(back-office)/back-office/security/page.tsx"),
  source("supabase/migrations/20260903093000_final_pos_receipts_workspace.sql"),
  source("supabase/tests/database/phase_5_receipts_refunds.test.sql"),
]);

assert.match(posPage, /<PosReceiptHistory/, "POS receipts use one master/detail workspace");
assert.match(posHistory, /receiptsByDate/, "history is grouped by date");
assert.match(posHistory, /paymentLabel\(receipt\.payment_methods\).*formatTime/s, "rows show payment text and time");
assert.match(posHistory, /aria-label={`View receipt #\$\{receipt\.receipt_number\}`}/, "the whole row is keyboard selectable");
assert.doesNotMatch(posHistory, />View</, "rows do not include a View button");
assert.doesNotMatch(posHistory, /transition-all|hover:scale|active:scale/, "selection does not resize rows");
assert.match(posHistory, /ReceiptDetailSkeleton/, "loading stays in the detail pane");
assert.match(posHistory, /EllipsisVertical/, "receipt utilities use a vertical overflow icon");
assert.match(posHistory, />Print receipt</, "the utility menu includes print");
assert.match(posHistory, />Digital receipt</, "the utility menu includes digital delivery");
assert.doesNotMatch(posHistory, /Menu\.Item[\s\S]{0,160}>Refund</, "refund remains outside the utility menu");
assert.match(posHistory, /<ReceiptDocument/, "detail reuses the canonical receipt renderer");
assert.match(posHistory, /side="right"/, "compact viewports use a right-side receipt sheet");
assert.match(posHistory, /has_refundable_quantity/, "status uses authoritative remaining quantities");

assert.match(posSearch, /Clear receipt search/, "search has an inline clear control");
assert.match(posSearch, /if \(!value\) navigate\(""\)/, "manually clearing search restores history");
assert.match(posPage, /No receipt found/, "no results is distinct from empty history");
assert.match(posPage, /No receipts yet\./, "empty history has useful copy");
assert.match(receiptMigration, /normalized_query ~ '\^#\?\[0-9\]\+\$'/, "receipt search accepts hash and zero-padded numbers");

assert.match(refundForm, /Purchased · refunded · available/, "refund lines show purchased/refunded/available quantities");
assert.match(refundForm, /Review refund/, "refunds require a deliberate review step");
assert.match(refundForm, /Confirm \$\{formatMinorMoney\(totalMinor, currencyCode\)\} refund/, "review confirmation names the exact refund amount");
assert.match(refundForm, /Return eligible refunded items to inventory/, "the physical stock-return choice is explicit");
assert.match(refundForm, /return_to_stock: returnToStock/, "approval payload preserves physical-return intent");
assert.doesNotMatch(refundForm, /window\.confirm/, "refund confirmation uses the review step rather than a browser prompt");
assert.match(refundForm, /Approve with PIN/, "pending refunds offer nearby PIN approval");
assert.match(approvalDialog, /Request approval/, "pending refunds can remain for remote approval");
assert.match(refundForm, /window\.sessionStorage/, "the exact pending draft survives closing and reopening");
assert.match(refundForm, /loadManagerApprovalStatusAction/, "cashiers observe remote decisions");
assert.match(refundForm, /Refund approval requires a connection/, "offline refund approval fails clearly");
assert.match(approvalDialog, /<Dialog\.Root/, "PIN approval uses the focus-managed dialog primitive");
assert.match(approvalActions, /loadManagerApprovalStatusAction/, "approval status loads through an authorized server action");
assert.match(securityPage, /<ApprovalRequestActions/, "authorized Back Office users can approve or reject requests");

assert.match(refundAction, /\.rpc\("refund_sale"/, "refund completion still uses the canonical RPC");
assert.match(refundAction, /target_idempotency_key/, "refund completion remains idempotent");
assert.match(refundAction, /return_to_stock: item\.returnToStock/, "refund action sends the explicit stock-return disposition");
assert.match(receiptMigration, /private\.authorize_sensitive_operation/, "completion reuses scoped approval authorization");
assert.match(receiptMigration, /private\.validate_refund_approval_payload/, "approval validates the exact receipt and lines");
assert.match(receiptMigration, /create or replace function public\.decide_manager_approval/, "remote decisions use a server-authorized RPC");
assert.match(receiptMigration, /'APPROVAL_REJECTED'/, "rejection is audited");
assert.match(receiptMigration, /private\.has_sale_read_scope/, "digital delivery enforces sale/store scope");
assert.match(receiptMigration, /revoke all on function public\.get_pos_receipt_history/, "receipt projections remain least privilege");
assert.doesNotMatch(receiptMigration, /create table/i, "the redesign does not duplicate receipt/refund records");
assert.match(refundDatabaseTest, /POS receipt history keeps a partially refunded receipt refundable/, "database tests cover partial refunds");
assert.match(refundDatabaseTest, /POS receipt history marks a fully returned receipt/, "database tests cover full refunds");

console.log("Receipt workspace and refund approval checks passed.");
