import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const drawer = await readFile(
  new URL("../src/features/pos/pos-operational-drawer.tsx", import.meta.url),
  "utf8",
);
const terminal = await readFile(
  new URL("../src/features/pos/pos-terminal.tsx", import.meta.url),
  "utf8",
);
const posPage = await readFile(
  new URL("../src/app/(pos)/pos/page.tsx", import.meta.url),
  "utf8",
);

test("cashier tools use a responsive left hamburger menu with a capability-scoped workspace switch", () => {
  assert.doesNotMatch(drawer, /PosOperationalSidebar/);
  assert.match(drawer, /aria-label="Open POS navigation"/);
  assert.match(drawer, /aria-label="Close POS navigation"/);
  assert.match(drawer, /buttonVariants\(\{ size: "icon", variant: "outline" \}\)/);
  assert.match(drawer, /showCloseButton=\{false\} side="left"/);
  assert.match(drawer, /Available features/);
  assert.match(drawer, /const closeNavigation = \(\) => setOpen\(false\)/);
  assert.match(drawer, /onClick=\{onNavigate\}/);
  assert.doesNotMatch(drawer, /POS settings/);
  assert.doesNotMatch(drawer, /requestFullscreen/);
  assert.doesNotMatch(drawer, /Enter full-screen mode/);
  assert.match(drawer, /canAccessBackOffice \? \(/);
  assert.match(drawer, /href="\/back-office"/);
});

test("active terminal keeps the existing sync status and adds a customer header shortcut", () => {
  assert.match(terminal, /<OfflineQueueStatus scope=\{offlineScope\} \/>/);
  assert.match(terminal, /aria-label="Select customer"/);
  assert.match(terminal, /onClick=\{focusCustomerPicker\}/);
  assert.doesNotMatch(terminal, /PosOperationalSidebar/);
  assert.match(terminal, /sm:justify-between/);
  assert.match(terminal, /order-1 self-start/);
  assert.match(terminal, /flex min-w-0 flex-col items-end gap-3/);
  assert.match(terminal, /order-1 flex min-w-0 items-center gap-3 sm:order-2/);
  assert.match(terminal, /order-2 flex flex-wrap items-center gap-2 sm:order-1/);
  assert.match(terminal, /min-h-svh bg-background/);
});

test("POS remains sales-permission-gated and retains the shift gate", () => {
  assert.match(posPage, /hasPermission\(context, "sales\.create"\)/);
  assert.match(terminal, /PosShiftGate/);
  assert.match(terminal, /openShiftAction/);
  assert.match(terminal, /closeShiftAction/);
});

test("Phase 4 does not add checkout, offline, or database command implementations", () => {
  assert.match(terminal, /PaymentScreen/);
  assert.match(terminal, /OfflineQueueStatus/);
  assert.doesNotMatch(drawer, /supabase\.from\(/);
  assert.doesNotMatch(drawer, /\.rpc\(/);
});
