import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

function navigationGroup(sourceCode, label) {
  const start = sourceCode.indexOf(`label: "${label}"`);
  assert.notEqual(start, -1, `${label} group must exist`);
  const end = sourceCode.indexOf("\n  },", start);
  return sourceCode.slice(start, end === -1 ? undefined : end);
}

test("Back Office keeps one reporting destination for the existing reporting workspace", async () => {
  const navigation = await source("src/components/back-office/back-office-navigation.tsx");
  const reports = navigationGroup(navigation, "Reports");

  assert.match(reports, /href: "\/back-office\/reports"/);
  assert.match(reports, /label: "Business"/);
  assert.match(reports, /pageTitle: "Business Reports"/);
  assert.match(reports, /label: "Shifts"/);
  assert.match(reports, /pageTitle: "Shift Reports"/);
  assert.match(reports, /href: "\/back-office\/shifts"/);
  assert.doesNotMatch(reports, /href: "\/back-office\/reports\//);
});

test("Sales keeps receipt and return work together without adding a duplicate route", async () => {
  const navigation = await source("src/components/back-office/back-office-navigation.tsx");
  const sales = navigationGroup(navigation, "Sales");

  assert.match(sales, /href: "\/back-office\/receipts"/);
  assert.match(sales, /label: "Receipts"/);
  assert.doesNotMatch(sales, /Kitchen display/);
  assert.doesNotMatch(navigation, /href: "\/back-office\/open-tickets"/);
});

test("Kitchen remains available as a separately permission-gated operational display", async () => {
  const navigation = await source("src/components/back-office/back-office-navigation.tsx");
  const operations = navigationGroup(navigation, "Operations");

  assert.match(operations, /href: "\/kitchen"/);
  assert.match(operations, /canViewKitchen === true/);
});

test("Settings labels expose the existing profile/features and advanced-sales surfaces", async () => {
  const navigation = await source("src/components/back-office/back-office-navigation.tsx");
  const settings = navigationGroup(navigation, "Settings");

  assert.match(settings, /label: "Business"/);
  assert.match(settings, /pageTitle: "Business profile & features"/);
  assert.match(settings, /label: "Discounts & Taxes"/);
});

test("navigation remains permission-aware and Inventory uses three sibling workspaces", async () => {
  const [navigation, inventory, workspaceNavigation, countWorkspace, advancedWorkflows, integrityWorkflows] = await Promise.all([
    source("src/components/back-office/back-office-navigation.tsx"),
    source("src/app/(back-office)/back-office/inventory/page.tsx"),
    source("src/features/inventory/inventory-workspace-navigation.tsx"),
    source("src/features/inventory/inventory-count-workspace.tsx"),
    source("src/features/inventory/advanced-inventory-workflows.tsx"),
    source("src/features/inventory/inventory-integrity-workflows.tsx"),
  ]);

  assert.match(navigation, /isVisible: \(access: BackOfficeNavigationAccess\) => boolean;/);
  const inventoryGroup = navigationGroup(navigation, "Inventory");
  for (const label of ["Stock Control", "Stock & Restock", "Purchasing"]) {
    assert.match(inventoryGroup, new RegExp(`label: "${label}"`));
  }
  for (const href of ["/back-office/inventory", "/back-office/replenishment?tab=levels", "/back-office/purchasing?tab=purchase-orders"]) {
    assert.match(inventoryGroup, new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const label of ["Overview", "Inventory activity", "Stock adjustments", "Inventory counts", "Purchase orders", "Receiving", "Suppliers", "Supplier returns", "Transfer orders", "Inventory valuation"]) {
    assert.match(workspaceNavigation, new RegExp(`label: "${label}"`));
  }
  assert.doesNotMatch(workspaceNavigation.split("const purchasingItems")[0], /id: "receiving"/);
  assert.match(workspaceNavigation, /className="flex flex-wrap items-center gap-1"/);
  assert.doesNotMatch(workspaceNavigation, /min-w-max/);
  assert.ok(inventory.indexOf("<InventoryWorkspaceNavigation") < inventory.indexOf("<DashboardActionGrid"));
  assert.match(countWorkspace, /Count documents/);
  assert.match(countWorkspace, /<BackOfficeDetailDrawer/);
  assert.match(countWorkspace, /New inventory count/);
  assert.match(inventory, /sections=\{\["purchasing"\]\}/);
  assert.match(inventory, /workspace === "control" && legacyPurchasingTab/);
  assert.match(inventory, /const purchasingTabHref/);
  // Transfers use the approval-aware request/receipt path. Do not require the
  // older immediate-transfer form, which remains only as a marked candidate
  // for removal while historical QA is completed.
  assert.match(inventory, /InventoryTransferWorkspace/);
  assert.match(inventory, /sections=\{\["transfer-receipt"\]\}/);
  assert.match(advancedWorkflows, /export type AdvancedInventorySection = "purchasing" \| "counts" \| "transfers";/);
  assert.match(integrityWorkflows, /export type InventoryIntegritySection =/);
});

test("shared Back Office shell defaults to section-only navigation and expands from the fixed header", async () => {
  const [navigation, shell, layout] = await Promise.all([
    source("src/components/back-office/back-office-navigation.tsx"),
    source("src/components/back-office/back-office-workspace-shell.tsx"),
    source("src/app/(back-office)/back-office/layout.tsx"),
  ]);

  assert.match(navigation, /collapsed = false/);
  assert.match(navigation, /<Tooltip content=\{navigationLabel\} side="right">/);
  assert.match(navigation, /ExpandableNavigationGroup/);
  assert.match(navigation, /onNavigate=\{mobile \? onNavigate : undefined\}/);
  assert.match(navigation, /min-h-0 flex-1 overflow-y-auto/);
  assert.match(navigation, /type NavigationGroup = \{\s+id: string;\s+icon: LucideIcon;/);
  assert.match(navigation, /function CollapsedNavigationSection/);
  assert.match(navigation, /function CollapsedNavigation/);
  assert.match(navigation, /<CollapsedNavigation/);
  assert.match(navigation, /createPortal\(/);
  assert.match(navigation, /document\.addEventListener\("pointerdown", closeWhenClickingOutside\)/);
  assert.match(navigation, /const openGroupId = openGroupState\?\.pathname === pathname \? openGroupState\.id : null;/);
  assert.match(navigation, /const toggleGroup = \(groupId: string\) =>/);
  assert.match(navigation, /setOpenGroupState\(\{ id: groupId, pathname \}\)/);
  assert.match(navigation, /active=\{group\.items\.some\(\(item\) => isCurrentRoute\(pathname, item\.href\)\)\}/);
  assert.match(navigation, /function useNavigationAccordion/);
  assert.match(navigation, /aria-expanded=\{isOpen\}/);
  assert.doesNotMatch(navigation, /<details/);
  assert.match(shell, /const \[isDesktopSidebarCollapsed, setIsDesktopSidebarCollapsed\] = useState\(true\);/);
  assert.match(shell, /const \[isMobileNavigationOpen, setIsMobileNavigationOpen\] = useState\(false\);/);
  assert.match(shell, /export function BackOfficeHeaderControls/);
  assert.match(shell, /<Menu aria-hidden="true" \/>/);
  assert.match(shell, /aria-expanded=\{isNavigationExpanded\}/);
  assert.match(shell, /getBackOfficePageTitle\(pathname\)/);
  assert.match(shell, /export function BackOfficeMobileNavigation/);
  assert.match(shell, /lg:grid-cols-\[5rem_minmax\(0,1fr\)\]/);
  assert.match(shell, /lg:grid-cols-\[16rem_minmax\(0,1fr\)\]/);
  assert.match(shell, /header: ReactNode;/);
  assert.match(shell, /\{header\}/);
  assert.match(shell, /min-h-\[calc\(100svh-3\.5rem\)\]/);
  assert.match(shell, /lg:top-14 lg:flex lg:h-\[calc\(100svh-3\.5rem\)\]/);
  assert.doesNotMatch(shell, /TindioMark/);
  assert.match(shell, /<Dialog\.Root modal onOpenChange=\{setIsMobileNavigationOpen\} open=\{isMobileNavigationOpen\}>/);
  assert.match(shell, /side="left"/);
  assert.match(shell, /<BackOfficeNavigation \{\.\.\.navigationAccess\} collapsed=\{isDesktopSidebarCollapsed\} \/>/);
  assert.match(layout, /<BackOfficeWorkspaceShell/);
  assert.match(layout, /header=\{\(/);
  assert.match(layout, /<BackOfficeHeaderControls \/>/);
  assert.match(layout, /<BackOfficeMobileNavigation[\s\S]*navigationAccess=\{navigationAccess\}/);
  assert.match(layout, /className="flex h-14 w-full items-center justify-between gap-3 px-4 sm:px-6 lg:px-8"/);
  assert.doesNotMatch(layout, /mx-auto flex min-h-15 w-full max-w-7xl/);
  assert.match(layout, /fixed inset-x-0 top-0/);
  assert.match(shell, /min-h-svh bg-muted\/35 pt-14/);
});
