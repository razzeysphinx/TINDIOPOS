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

test("cashier drawer has navigation and POS display settings without Back Office navigation", () => {
  assert.match(drawer, /Cashier navigation/);
  assert.match(drawer, /POS settings/);
  assert.match(drawer, /document\.documentElement\.requestFullscreen\(\)/);
  assert.doesNotMatch(drawer, /href="\/back-office"/);
});

test("active terminal keeps the existing sync status and adds a customer header shortcut", () => {
  assert.match(terminal, /<OfflineQueueStatus scope=\{offlineScope\} \/>/);
  assert.match(terminal, /aria-label="Select customer"/);
  assert.match(terminal, /onClick=\{focusCustomerPicker\}/);
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
