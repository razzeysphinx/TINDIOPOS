import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const paths = {
  actions: "../src/features/management/actions.ts",
  data: "../src/features/management/data.ts",
  drawerAction: "../src/features/management/quick-view/actions.ts",
  drawerShell: "../src/components/back-office/back-office-detail-drawer.tsx",
  navigation: "../src/components/back-office/back-office-navigation.tsx",
  overview: "../src/app/(back-office)/back-office/stores-registers/page.tsx",
  overviewClient: "../src/features/management/stores-registers-overview.tsx",
};

const source = Object.fromEntries(await Promise.all(
  Object.entries(paths).map(async ([name, path]) => [name, await readFile(new URL(path, import.meta.url), "utf8")]),
));

test("stores and registers overview is a capability-gated, store-scoped primary workspace", () => {
  const overviewLoader = source.data.slice(
    source.data.indexOf("export async function loadManagementStoreRegisterOverview"),
    source.data.indexOf("export async function loadManagementStoreDrawer"),
  );
  assert.match(source.overview, /requireBackOfficePermission\(\["stores\.manage", "registers\.manage"\]\)/);
  assert.match(source.overview, /loadManagementStoreRegisterOverview\(context\)/);
  assert.match(source.data, /hasOrganizationWideStoreScope\(context\)/);
  assert.match(source.data, /storesQuery = storesQuery\.in\("id", assignedStoreIds\)/);
  assert.match(source.data, /registersQuery = registersQuery\.in\("store_id", assignedStoreIds\)/);
  assert.match(source.data, /\.from\("shifts"\)/);
  assert.match(source.data, /\.from\("pos_devices"\)/);
  assert.match(source.data, /\.from\("offline_sync_events"\)/);
  assert.doesNotMatch(overviewLoader, /get_shift_cash_summary|get_pos_shift_operational_summary/);
});

test("overview preserves existing setup paths while making Stores and Registers the primary entry", () => {
  assert.match(source.overview, /CreateStoreForm/);
  assert.match(source.overview, /CreateRegisterForm/);
  assert.match(source.overview, /Search stores/);
  assert.match(source.overviewClient, /Needs attention/);
  assert.match(source.navigation, /href: "\/back-office\/stores-registers"/);
  assert.match(source.navigation, /label: "Stores & Registers"/);
  assert.doesNotMatch(source.navigation, /href: "\/back-office\/stores", label: "Stores"/);
  assert.doesNotMatch(source.navigation, /href: "\/back-office\/registers", label: "Registers"/);
  assert.match(source.actions, /revalidatePath\("\/back-office\/stores-registers"\)/);
});

test("store quick view opens on demand, preserves focus, and uses central store scope", () => {
  assert.match(source.drawerAction, /requireBackOfficePermission\(\["stores\.manage", "registers\.manage"\]\)/);
  assert.match(source.drawerAction, /loadManagementStoreDrawer\(context, parsed\.data\.storeId\)/);
  assert.match(source.data, /export async function loadManagementStoreDrawer/);
  assert.match(source.data, /hasStoreAccess\(context, storeId\)/);
  assert.match(source.data, /\.eq\("store_id", storeId\)/);
  assert.match(source.overviewClient, /aria-label={`View store \$\{store\.name\}, \$\{store\.code\}`}/);
  assert.match(source.overviewClient, /<BackOfficeDetailDrawer closeLabel="Close details" width="wide">/);
  assert.match(source.overviewClient, /const \[drawerView, setDrawerView\] = useState<"store" \| "register">\("store"\)/);
  assert.match(source.overviewClient, /setDrawerView\("register"\)/);
  assert.match(source.overviewClient, /function RegisterDrawerHeader/);
  assert.match(source.overviewClient, /function RegisterDrawerBody/);
  assert.match(source.overviewClient, /onReturnToStore=\{returnToStore\}/);
  assert.doesNotMatch(source.overviewClient, /setIsRegisterDrawerOpen|closeRegisterDrawer/);
  assert.match(source.drawerShell, /side="right"/);
  assert.match(source.overviewClient, /if \(requestId\.current !== currentRequest\) return;/);
  assert.match(source.overviewClient, /document\.getElementById\(focusTargetId\)\?\.focus\(\)/);
  assert.match(source.overviewClient, /aria-label="Loading store"/);
  assert.match(source.overviewClient, /We couldn&apos;t load this store\./);
});

test("register operational drawer starts from scoped identity data", () => {
  const registerDrawerLoader = source.data.slice(
    source.data.indexOf("export async function loadManagementRegisterDrawer"),
    source.data.indexOf("type RegisterOperationalSummaryRpc"),
  );
  assert.match(source.drawerAction, /loadManagementRegisterOperationalDrawer\(context, parsed\.data\.registerId\)/);
  assert.match(registerDrawerLoader, /registerQuery = registerQuery\.in\("store_id", assignedStoreIds\)/);
  assert.match(registerDrawerLoader, /hasStoreAccess\(context, registerResult\.data\.store_id\)/);
  assert.match(source.overviewClient, /onOpenRegister=\{openRegister\}/);
  assert.match(source.overviewClient, /aria-label={`Open register \$\{register\.name\}, \$\{register\.code\},/);
  assert.match(source.overviewClient, /aria-label="Loading register"/);
  assert.match(source.overviewClient, /We couldn&apos;t load this register\./);
  assert.match(source.overviewClient, /EditRegisterButton/);
  assert.match(source.overviewClient, /if \(registerRequestId\.current !== currentRequest\) return;/);
  assert.doesNotMatch(registerDrawerLoader, /get_shift_cash_summary|get_pos_shift_operational_summary|offline_sync_events|pos_devices/);
});

test("register operational drawer reuses the authoritative shift summary and recorded device/sync evidence", () => {
  const operationalLoader = source.data.slice(
    source.data.indexOf("export async function loadManagementRegisterOperationalDrawer"),
    source.data.indexOf("export async function loadManagementRoles"),
  );
  assert.match(operationalLoader, /hasAnyPermission\(context, \["shifts\.open", "shifts\.close", "cash\.pay_in", "cash\.pay_out"\]\)/);
  assert.match(operationalLoader, /get_pos_shift_operational_summary/);
  assert.doesNotMatch(operationalLoader, /get_shift_cash_summary/);
  assert.match(operationalLoader, /hasPermission\(context, "devices\.manage"\)/);
  assert.match(operationalLoader, /\.from\("pos_devices"\)/);
  assert.match(operationalLoader, /\.from\("offline_sync_events"\)/);
  assert.match(operationalLoader, /\["LOCAL_PENDING", "SYNCING"\]/);
  assert.match(operationalLoader, /\["CONFLICT", "FAILED"\]/);
  assert.match(source.overviewClient, /CurrentShiftSection/);
  assert.match(source.overviewClient, /Cash drawer/);
  assert.match(source.overviewClient, /Hidden until close/);
  assert.match(source.overviewClient, /Server-recorded sync queue/);
  assert.match(source.overviewClient, /device-local work appears after a synchronization attempt/);
  assert.match(source.overviewClient, /Needs attention/);
  assert.match(source.overviewClient, /Shift open/);
  assert.match(source.overviewClient, /Shift closed/);
  assert.match(source.overviewClient, /EditStoreButton/);
  assert.match(source.overviewClient, /View technical details/);
  assert.match(source.overviewClient, /<details/);
});
