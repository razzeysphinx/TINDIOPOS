import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [contextHelp, reports, inventoryPage, inventoryStock] = await Promise.all([
  source("../src/components/back-office/context-help.tsx"),
  source("../src/features/reports/reporting-overview.tsx"),
  source("../src/app/(back-office)/back-office/inventory/page.tsx"),
  source("../src/features/inventory/inventory-stock-view.tsx"),
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

test("all existing Back Office question-mark help call sites use the shared component", () => {
  for (const [label, content] of [
    ["report metric definitions", reports],
    ["inventory health", inventoryPage],
    ["inventory stock", inventoryStock],
  ]) {
    assert.match(content, /<ContextHelp/, `${label} must use the shared contextual-help component`);
  }
  assert.match(reports, /Completed sales minus recorded refunds/);
  assert.match(inventoryStock, /quantity TINDIO currently records/);
});

console.log("Contextual-help interaction and coverage checks passed.");
