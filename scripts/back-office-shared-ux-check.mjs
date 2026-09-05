import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const paths = {
  breadcrumbs: "../src/components/back-office/back-office-breadcrumbs.tsx",
  detailDrawer: "../src/components/back-office/back-office-detail-drawer.tsx",
  header: "../src/components/back-office/page-header.tsx",
  navigation: "../src/components/back-office/back-office-navigation.tsx",
  navigationContext: "../src/components/back-office/back-office-navigation-context.tsx",
  shell: "../src/components/back-office/back-office-workspace-shell.tsx",
  catalog: "../src/features/catalog/catalog-product-workspace.tsx",
  employees: "../src/app/(back-office)/back-office/employees/page.tsx",
  receipts: "../src/features/receipts/receipt-list-quick-view.tsx",
  storesRegisters: "../src/features/management/stores-registers-overview.tsx",
  shifts: "../src/features/shifts/shift-manager.tsx",
};

const source = Object.fromEntries(await Promise.all(
  Object.entries(paths).map(async ([name, path]) => [name, await readFile(new URL(path, import.meta.url), "utf8")]),
));

test("breadcrumbs derive from the existing permission-aware navigation registry", () => {
  assert.match(source.navigation, /export function getBackOfficeBreadcrumbs/);
  assert.match(source.navigation, /item\.isVisible\(access\)/);
  assert.match(source.navigation, /function routePathname\(href: string\)/);
  assert.match(source.navigation, /pathname !== routePathname\(match\.item\.href\)/);
  assert.match(source.navigationContext, /BackOfficeNavigationContext/);
  assert.match(source.shell, /<BackOfficeNavigationProvider access=\{navigationAccess\}>/);
  assert.match(source.header, /<BackOfficeBreadcrumbs currentLabel=\{title\} \/>/);
  assert.match(source.breadcrumbs, /usePathname\(\)/);
  assert.match(source.breadcrumbs, /aria-current=\{isCurrent \? "page" : undefined\}/);
  assert.match(source.breadcrumbs, /<Link/);
});

test("record drawers share responsive geometry without sharing business state", () => {
  assert.match(source.detailDrawer, /side="right"/);
  assert.match(source.detailDrawer, /"flex h-dvh max-h-none max-w-none flex-col rounded-none"/);
  assert.match(source.detailDrawer, /compact: "sm:max-w-xl"/);
  assert.match(source.detailDrawer, /standard: "sm:max-w-\[40rem\]"/);
  assert.match(source.detailDrawer, /wide: "sm:max-w-\[42rem\]"/);
  assert.match(source.catalog, /<BackOfficeDetailDrawer closeLabel="Close product details" nonBlocking>/);
  assert.match(source.receipts, /<BackOfficeDetailDrawer closeLabel="Close receipt quick view" width="compact">/);
  assert.match(source.storesRegisters, /<BackOfficeDetailDrawer closeLabel="Close details" width="wide">/);
  assert.match(source.storesRegisters, /drawerView === "register"/, "Store and register inspection must reuse the same drawer hierarchy");
  assert.match(source.shifts, /<BackOfficeDetailDrawer closeLabel="Close shift report" width="compact">/);
});

test("Back Office retains readable compact layouts and contained data tables", () => {
  assert.match(source.shell, /lg:grid-cols-\[5rem_minmax\(0,1fr\)\]/, "Desktop navigation must preserve a minimum content column when collapsed");
  assert.match(source.shell, /lg:grid-cols-\[16rem_minmax\(0,1fr\)\]/, "Expanded navigation must not crush page content");
  assert.match(source.catalog, /grid grid-cols-2 gap-3 text-xs text-muted-foreground/, "Catalog mobile metrics must use two readable columns");
  assert.match(source.catalog, /col-span-2 min-w-0/, "Catalog selling availability must retain full-row space on small screens");
  assert.match(source.catalog, /title=\{sellingAvailability/, "Truncated selling availability must remain discoverable");
  assert.match(source.employees, /min-w-0 truncate" title=\{employee\.job_title/, "Long employee roles must not cause list-row overflow");
  assert.match(source.storesRegisters, /min-w-0 break-words/, "Long store addresses must wrap within store cards");
  assert.match(source.receipts, /md:hidden/, "Receipts must use compact cards before the desktop-table breakpoint");
  assert.match(source.shifts, /md:hidden/, "Shift reports must use compact cards before the desktop-table breakpoint");
});
