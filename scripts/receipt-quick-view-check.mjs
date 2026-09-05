import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const paths = {
  action: "../src/features/receipts/quick-view/actions.ts",
  detail: "../src/features/receipts/detail/data.ts",
  delivery: "../src/features/receipts/receipt-delivery-form.tsx",
  detailDrawer: "../src/components/back-office/back-office-detail-drawer.tsx",
  dialog: "../src/components/ui/dialog.tsx",
  drawer: "../src/features/receipts/receipt-list-quick-view.tsx",
  globals: "../src/app/globals.css",
  list: "../src/app/(back-office)/back-office/receipts/page.tsx",
  route: "../src/app/(back-office)/back-office/receipts/[receiptId]/page.tsx",
};
const source = Object.fromEntries(await Promise.all(
  Object.entries(paths).map(async ([name, path]) => [name, await readFile(new URL(path, import.meta.url), "utf8")]),
));

test("receipt quick view uses an authorized, canonical on-demand data loader", () => {
  assert.match(source.action, /requireBackOfficePermission\("receipts\.view"\)/);
  assert.match(source.action, /loadAuthorizedReceiptDetail\(context, parsed\.data\.receiptId\)/);
  assert.match(source.detail, /\.eq\("organization_id", context\.organization\.id\)/);
  assert.match(source.detail, /if \(!hasStoreAccess\(context, sale\.store_id\)\) return null/);
  assert.match(source.detail, /deliveryRecipientEmail: customerEmailResult\.data\?\.email \?\? null/);
  assert.match(source.detail, /\.from\("customers"\)\s*\.select\("email"\)/);
  assert.match(source.route, /loadAuthorizedReceiptDetail\(context, receiptId\)/);
});

test("receipt list opens a right drawer without retaining a View button", () => {
  assert.match(source.list, /<ReceiptListQuickView groups=\{quickViewGroups\}/);
  assert.doesNotMatch(source.list, /<ReceiptRefundActions/);
  assert.doesNotMatch(source.list, /<CardHeader/);
  assert.doesNotMatch(source.list, /<CardTitle>/);
  assert.match(source.list, /<Card>[\s\S]*?<GlobalFilterBar[\s\S]*?embedded[\s\S]*?<ReceiptListQuickView/, "Filters and receipt results must share one card");
  assert.match(source.list, /showEmbeddedDividers=\{false\}/, "Receipts filters must use whitespace rather than divider bars");
  assert.match(source.list, /collapsibleAdditionalFields/, "Secondary receipt filters must use progressive disclosure");
  assert.match(source.list, /activeAdditionalFilterCount/, "Collapsed advanced filters must expose their active count");
  assert.match(source.list, /primaryAdditionalFields=\{<label[^>]*>Sort<select/, "Sort must be a deliberate primary filter control");
  assert.match(source.drawer, /role="button"/);
  assert.match(source.drawer, /onKeyDown=\{\(event\) =>/);
  assert.match(source.drawer, /aria-label=\{`View receipt #\$\{receipt\.number\}`\}/);
  assert.match(source.drawer, />Reference</);
  assert.match(source.drawer, />Register</);
  assert.match(source.drawer, />Cashier</);
  assert.doesNotMatch(source.drawer, />Receipt</);
  assert.match(source.drawer, /formatReceiptDate\(receipt\.issuedAt, timezone\).*receipt\.refundStatus/s, "Date must appear directly below the receipt reference");
  assert.doesNotMatch(source.drawer, />Actions</);
  assert.doesNotMatch(source.drawer, /ReceiptRefundActions/);
  assert.match(source.drawer, /paymentSummary\(paymentNames\)/);
  assert.match(source.drawer, /Payment methods:/);
  assert.doesNotMatch(source.drawer, /Loading receipt…/, "Receipt rows must remain stable while the drawer loads");
  assert.match(source.drawer, /md:hidden/, "Mobile receipts must use a compact card layout instead of the wide table");
  assert.match(source.drawer, /<BackOfficeDetailDrawer closeLabel="Close receipt quick view" width="compact">/);
  assert.match(source.detailDrawer, /side="right"/);
  assert.match(source.detailDrawer, /"flex h-dvh max-h-none max-w-none flex-col rounded-none"/);
  assert.match(source.drawer, /<DialogBody className="min-h-0 max-h-none flex-1">/);
  assert.match(source.drawer, /className="min-h-full"/);
  assert.match(source.dialog, /const isSideDrawer = side !== "center"/);
  assert.match(source.dialog, /isSideDrawer && "transition-\[transform,opacity\] data-starting-style:opacity-0 data-ending-style:opacity-0"/);
  assert.match(source.dialog, /data-starting-style:translate-x-full data-ending-style:translate-x-full/);
  assert.doesNotMatch(source.dialog, /side === "right" && "[^"\n]*scale/);
  assert.match(source.globals, /scrollbar-gutter: stable/);
});

test("quick-view errors, printing, compact digital delivery, and refunds remain explicit", () => {
  assert.match(source.drawer, /We couldn&apos;t load this receipt\./);
  assert.match(source.drawer, /Try again/);
  assert.match(source.drawer, /<ReceiptPrintButton printMode="receipt"/);
  assert.match(source.drawer, /Digital receipt/);
  assert.match(source.drawer, /<DialogTitle>Send digital receipt<\/DialogTitle>/);
  assert.match(source.drawer, /presentation="dialog"/);
  assert.match(source.drawer, /initialRecipient=\{detail\.deliveryRecipientEmail\}/);
  assert.doesNotMatch(source.drawer, /<ReceiptSurface detail=\{detail\} timezone=\{timezone\} \/>\s*<ReceiptDeliveryForm/);
  assert.match(source.delivery, /queueReceiptDeliveryAction/);
  assert.match(source.delivery, /Enter an email address\./);
  assert.match(source.delivery, /Enter a valid email address\./);
  assert.match(source.delivery, /\{isPending \? "Sending\.\.\." : "Send receipt"\}/);
  assert.match(source.drawer, /\?refund=1#refund/);
  assert.doesNotMatch(source.drawer, /Open full receipt/);
  assert.match(source.drawer, /requestId\.current !== currentRequest/);
});
