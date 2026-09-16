import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [contextHelp, reports, inventoryStock, inventoryHealth] = await Promise.all([
  source("../src/components/back-office/context-help.tsx"),
  source("../src/features/reports/reporting-overview.tsx"),
  source("../src/features/inventory/inventory-stock-view.tsx"),
  source("../src/features/inventory/inventory-health-workspace.tsx"),
]);

test("contextual help uses one accessible interactive popover implementation", () => {
  assert.match(contextHelp, /^"use client";/);
  assert.match(contextHelp, /import \{ Popover \} from "@base-ui\/react\/popover"/);
  assert.doesNotMatch(contextHelp, /components\/ui\/tooltip/);
  assert.match(contextHelp, /<Popover\.Trigger/);
  assert.match(contextHelp, /type="button"/);
  assert.match(contextHelp, /aria-label=\{accessibleLabel\}/);
  assert.match(contextHelp, /size-8/);
  assert.match(contextHelp, /openOnHover/);
  assert.match(contextHelp, /onFocus=\{openHelp\}/);
  assert.match(contextHelp, /<Popover\.Portal>/);
  assert.match(contextHelp, /z-\[100\]/);
  assert.match(contextHelp, /<Popover\.Close/);
});

test("contextual help is compact, meaningful, and has one active popup at a time", () => {
  assert.match(contextHelp, /hasMeaningfulContent/);
  assert.match(contextHelp, /was not rendered because it has no explanation/);
  assert.match(contextHelp, /contextHelpOpenEvent/);
  assert.match(contextHelp, /closeWhenAnotherHelpOpens/);
  assert.match(contextHelp, /<Popover\.Title/);
  assert.match(contextHelp, /<Popover\.Description/);
});

test("existing question-mark help call sites use the shared ContextHelp component", () => {
  for (const [label, content] of [
    ["report metric definitions", reports],
    ["inventory stock", inventoryStock],
  ]) {
    assert.match(content, /<ContextHelp/, `${label} must use the shared contextual-help component`);
  }
  assert.match(reports, /Completed sales minus recorded refunds/);
  assert.match(inventoryStock, /quantity TINDIO currently records/);
});

test("inventory health uses direct explanatory copy instead of requiring an orphan help control", () => {
  assert.match(inventoryHealth, /Inventory overview/);
  assert.match(inventoryHealth, /Signals are derived from current stock, completed counts, and open inventory documents/);
  assert.match(inventoryHealth, /This view never changes stock automatically/);
});

console.log("Contextual-help interaction and coverage checks passed.");
