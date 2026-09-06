import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

const [provider, layout, inventory] = await Promise.all([
  source("src/components/unsaved-changes/unsaved-changes-provider.tsx"),
  source("src/app/(back-office)/back-office/layout.tsx"),
  source("src/features/inventory/inventory-integrity-workflows.tsx"),
]);

test("one shared Back Office provider owns leave confirmation", () => {
  assert.match(layout, /<UnsavedChangesProvider>/);
  assert.match(provider, /createContext<UnsavedChangesContextValue/);
  assert.match(provider, /export function useUnsavedChanges/);
  assert.match(provider, /Discard unsaved changes\?/);
  assert.match(provider, /Stay on this page/);
  assert.match(provider, /Leave without saving/);
});

test("dirty drafts protect links and native page exits without replacing navigation", () => {
  assert.match(provider, /document\.addEventListener\("click", onDocumentClick, true\)/);
  assert.match(provider, /router\.push\(`\$\{destination\.pathname\}/);
  assert.match(provider, /window\.addEventListener\("beforeunload", onBeforeUnload\)/);
  assert.match(provider, /window\.addEventListener\("popstate", onPopState\)/);
  assert.match(provider, /history\.pushState/);
});

test("the inventory policy editor uses the shared guard for a real store-context switch", () => {
  assert.match(inventory, /useUnsavedChanges\(/);
  assert.match(inventory, /hasUnsavedPolicyChanges/);
  assert.match(inventory, /requestOverrideStoreChange/);
  assert.match(inventory, /requestCloseOverrideEditor/);
  assert.match(inventory, /Discard unsaved stock policy changes\?/);
});
