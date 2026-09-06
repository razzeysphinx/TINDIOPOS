import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

const [manager, data, publicView, databaseTest] = await Promise.all([
  source("src/features/smart-menu/smart-menu-manager.tsx"),
  source("src/features/smart-menu/data.ts"),
  source("src/features/smart-menu/public-smart-menu.tsx"),
  source("supabase/tests/database/planning_phase_7_smart_menu.test.sql"),
]);

test("Smart Menu remains store-scoped configuration over the Catalog source of truth", () => {
  assert.match(data, /from\("products"\)/);
  assert.match(data, /from\("smart_menus"\)/);
  assert.match(data, /from\("smart_menu_categories"\)/);
  assert.match(data, /from\("smart_menu_products"\)/);
  assert.match(databaseTest, /public projection follows the current store price override/);
  assert.match(publicView, /Product availability, prices, images, variants, and options are set by this business in TINDIO/);
});

test("the builder uses explicit publication, grouped display settings, and customer preview", () => {
  assert.match(manager, /Menu status/);
  assert.match(manager, /Publish menu/);
  assert.match(manager, /Unpublish menu/);
  assert.match(manager, /Customer display/);
  assert.match(manager, /Unavailable products/);
  assert.match(manager, /Customer preview/);
  assert.match(manager, /Show QR/);
  assert.doesNotMatch(manager, /label="Publish Smart Menu"/);
});

test("menu content is searchable and does not render every product until a category is expanded", () => {
  assert.match(manager, /Search categories or products/);
  assert.match(manager, /expandedCategoryIds/);
  assert.match(manager, /\{expanded \? <div className="space-y-1 border-t p-2\.5">/);
  assert.match(manager, /visible of \{categoryProducts\.length\} products/);
  assert.match(manager, /moveProductWithinCategory/);
});

test("Smart Menu uses the shared unsaved-changes guard for store changes", () => {
  assert.match(manager, /useUnsavedChanges/);
  assert.match(manager, /Discard unsaved Smart Menu changes\?/);
  assert.match(manager, /requestStoreChange/);
  assert.match(manager, /requestNavigation\(\(\) => selectStore/);
});
