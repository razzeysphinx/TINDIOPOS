import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

const [drawer, header, terminal, responsive, capabilities, customerPicker, payment, receiptHistory, shiftManager, receiptMigration, shiftMigration, receiptPage, receiptDetail, itemsPage, settingsPage] = await Promise.all([
  source("src/features/pos/pos-operational-drawer.tsx"),
  source("src/features/pos/pos-workspace-header.tsx"),
  source("src/features/pos/pos-terminal.tsx"),
  source("src/features/pos/pos-responsive.ts"),
  source("src/features/pos/pos-capabilities.ts"),
  source("src/features/customers/pos-customer-picker.tsx"),
  source("src/features/checkout/payment-screen.tsx"),
  source("src/features/pos/pos-receipt-history.tsx"),
  source("src/features/shifts/shift-manager.tsx"),
  source("supabase/migrations/20260828065824_pos_workspace_receipt_access.sql"),
  source("supabase/migrations/20260828070815_pos_shift_summary_print.sql"),
  source("src/app/(pos)/pos/receipts/page.tsx"),
  source("src/app/(pos)/pos/receipts/[receiptId]/page.tsx"),
  source("src/app/(pos)/pos/items/page.tsx"),
  source("src/app/(pos)/pos/settings/page.tsx"),
]);

for (const [label, href] of [["Sales", "/pos"], ["Receipts", "/pos/receipts"], ["Shift", "/pos/shifts"], ["Items", "/pos/items"], ["Settings", "/pos/settings"]]) {
  assert.match(drawer, new RegExp(`label: "${label}"`), `${label} must be part of the shared POS navigation`);
  assert.match(drawer, new RegExp(`href: "${href.replaceAll("/", "\\/")}"`), `${label} must have its POS route`);
}

assert.match(header, /OfflineQueueStatus/, "POS header must expose automatic sync state");
assert.match(header, /sticky top-0 z-40/, "The shared POS header must remain above every scrolling POS workspace");
assert.match(header, /bg-card/, "The persistent POS header must use an opaque surface");
assert.match(header, /shadow-\[/, "The persistent POS header must retain a subtle scrolling separator");
assert.match(header, /onCreateCustomer/, "POS header must expose the New customer creation action");
assert.match(header, /onViewCart/, "POS header must provide the compact cart review action");
assert.match(header, /ShoppingCart/, "The compact cart review action must have a recognizable icon");
assert.doesNotMatch(header, /Close shift/, "Close shift belongs in the Shift workspace, not the POS header");
assert.doesNotMatch(header, /Ellipsis|MoreHorizontal/, "The global three-dot POS menu must not return");
assert.match(terminal, /PosWorkspaceHeader/, "Sales must use the shared POS header");
assert.match(terminal, /if \(!isOperational\)/, "The no-active-shift POS gate must remain in place");
assert.match(terminal, /readPosWorkspacePreferences/, "Sales must consume the POS item-layout preference");
assert.match(capabilities, /features\.dining/, "Dining must be controlled by configured features");
assert.match(capabilities, /features\.open_tickets/, "Open tickets must be controlled by configured features");
assert.match(capabilities, /showRestaurantControls/, "Restaurant presentation must be centralized");
assert.match(payment, /checkout-discount/, "Discount selection must be located in checkout");
assert.doesNotMatch(terminal, /No tax|Tax rate/, "Normal POS must not present a tax selector");
assert.match(terminal, /Popover\.Root/, "All items must use an anchored category popover");
const categoryPickerStart = terminal.indexOf("function CatalogCategoryPicker");
const categoryPickerEnd = terminal.indexOf("\nfunction ", categoryPickerStart + 1);
const categoryPicker = terminal.slice(categoryPickerStart, categoryPickerEnd);
assert.doesNotMatch(categoryPicker, /DialogContent/, "Category selection must not use a dialog");
assert.match(terminal, /border-y bg-card px-4 py-3/, "The category and Favorites controls must have a dedicated opaque toolbar");
assert.match(terminal, /pb-\[calc\(9rem\+env\(safe-area-inset-bottom\)\)\]/, "Compact POS must reserve space for the mobile cart summary");
assert.match(terminal, /useCompactPosPresentation/, "POS must use one shared responsive presentation decision");
assert.match(responsive, /max-width: 1023px/, "Compact POS breakpoint must cover phones and portrait tablets");
assert.match(terminal, /CartPanel/, "Desktop and compact cart views must reuse one cart presentation component");
assert.match(terminal, /MobileCartSummary/, "Compact POS must offer a persistent cart summary after an item is added");
assert.match(terminal, /setIsCartReviewOpen\(false\)/, "Entering checkout must close only the compact cart presentation, not reset cart state");
assert.doesNotMatch(terminal, /lg:sticky lg:top-0 lg:z-10/, "The catalog toolbar must not overlap product rows");
assert.match(terminal, /const \[favoritesOnly, setFavoritesOnly\] = useState\(false\)/, "Favorites must be an independent toggle state");
assert.match(terminal, /favoriteItems\.filter/, "Favorites must filter the existing catalog data rather than replace the category state");
assert.match(terminal, /onSelect=\{setSelectedCategoryId\}/, "Changing category must not leave Favorites mode");
assert.match(terminal, /onClick=\{\(\) => setFavoritesOnly\(\(current\) => !current\)\}/, "Favorites must toggle on and off");
assert.match(terminal, /No favorites in this category/, "Empty favorites must explain the current filter");
assert.match(terminal, /Show all items/, "Empty favorites must provide a way to leave Favorites mode");
assert.doesNotMatch(terminal, /catalogView|setCatalogView/, "Recent and Favorites view modes must not compete with category state");
assert.match(customerPicker, /PosCustomerCreateDialog/, "New customer must use the customer creation workflow");
assert.match(customerPicker, /Add customer/, "Cart customer action must remain an attach/search workflow");
assert.match(receiptHistory, /receiptsByDate/, "POS receipts must be grouped by date");
assert.match(receiptHistory, /ReceiptDetailSkeleton/, "Receipt loading must occur in the detail pane");
assert.match(receiptHistory, /isReceiptPreviewOpen/, "Compact POS receipts must use an explicit preview state");
assert.match(receiptHistory, /useCompactPosPresentation/, "Receipt detail must switch to a responsive sheet on compact screens");
assert.match(receiptHistory, /side="right"/, "Compact receipt preview must use the existing side-sheet primitive");
assert.doesNotMatch(receiptHistory, />View</, "POS receipt history must not require a View button");
assert.match(shiftManager, /canOpen && !hasOpenShift/, "An active shift must suppress the Open Shift form");
assert.match(shiftManager, /Shift history/, "Shift history must use a compact action");
assert.match(shiftManager, /CashMovementActivity/, "Cash Management must include its activity log");
assert.match(shiftManager, /ShiftCloseReviewTotals/, "Close shift must use the authoritative review totals");
assert.match(terminal, /itemLayout === "grid"/, "POS item layout must retain explicit grid/list behavior");
assert.doesNotMatch(terminal, /itemLayout === "list"[\s\S]{0,500}sku/, "Compact list rows must not expose SKU details");
assert.match(payment, /const completionBlockMessage/, "Payment completion must use one canonical state calculation");
assert.match(payment, /const completionLabel/, "Cash completion must use an explicit cash-sale label");
assert.match(payment, /Other payment methods[\s\S]*divide-y/, "Other methods must render as compact rows");
assert.match(payment, /safe-area-inset-bottom/, "Payment screens must preserve mobile safe-area clearance");
assert.match(payment, /lg:sticky lg:top-0/, "Desktop payment summary must remain reachable during long checkouts");

assert.match(receiptPage, /hasPermission\(context, "sales\.create"\)/, "POS receipt history must reject non-POS users");
assert.match(receiptDetail, /hasPermission\(context, "sales\.refund"\)/, "POS refunds must still require the refund permission");
assert.match(itemsPage, /hasPermission\(context, "sales\.create"\)/, "POS items must reject non-POS users");
assert.match(settingsPage, /hasPermission\(context, "sales\.create"\)/, "POS settings must reject non-POS users");

assert.match(receiptMigration, /private\.current_employee_id/, "Receipt RPCs must bind access to an active employee");
assert.match(receiptMigration, /public\.employee_stores/, "Receipt RPCs must bind access to an assigned store");
assert.match(receiptMigration, /sales\.refund/, "Cross-cashier receipt access must be limited to refund-capable roles");
assert.match(receiptMigration, /revoke all on function public\.get_pos_receipt_history/, "Receipt RPC must use least-privilege grants");
assert.doesNotMatch(receiptMigration, /create policy/i, "Receipt projection must not replace existing RLS policies");

assert.match(shiftMigration, /private\.calculate_shift_cash/, "Shift print data must be server-derived");
assert.match(shiftMigration, /show_expected_before_close/, "Shift summary must preserve blind-cash behavior");
assert.match(shiftMigration, /public\.sales/, "Shift summary must include authoritative sales records");
assert.match(shiftMigration, /public\.refunds/, "Shift summary must include authoritative refund records");

console.log("POS workspace navigation and security checks passed.");
