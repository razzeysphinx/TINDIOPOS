import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [toggle, categoriesPage, workspace, inventoryStock] = await Promise.all([
  source("src/components/back-office/view-toggle.tsx"),
  source("src/app/(back-office)/back-office/categories/page.tsx"),
  source("src/features/catalog/category-management-workspace.tsx"),
  source("src/features/inventory/inventory-stock-view.tsx"),
]);

test("the shared toggle uses the established compact icon-only selected state", () => {
  assert.match(toggle, /GridListViewToggle/);
  assert.match(toggle, /<List aria-hidden/);
  assert.match(toggle, /<Grid2X2 aria-hidden/);
  assert.match(toggle, /aria-label="List view"/);
  assert.match(toggle, /aria-label="Grid view"/);
  assert.match(toggle, /aria-pressed=\{value === "list"\}/);
  assert.match(toggle, /aria-pressed=\{value === "grid"\}/);
  assert.match(toggle, /Tooltip content="List view"/);
  assert.match(toggle, /Tooltip content="Grid view"/);
  assert.match(toggle, /variant=\{value === "list" \? "secondary" : "ghost"\}/);
  assert.match(toggle, /variant=\{value === "grid" \? "secondary" : "ghost"\}/);
});

test("view preference is browser-local and does not create a database dependency", () => {
  assert.match(toggle, /tindio-view-preference/);
  assert.match(toggle, /window\.localStorage\.getItem/);
  assert.match(toggle, /window\.localStorage\.setItem/);
  assert.doesNotMatch(toggle, /supabase|rpc\(|fetch\(/i);
});

test("Categories keeps one server-loaded dataset and both views preserve all existing actions", () => {
  assert.match(categoriesPage, /\.from\("categories"\)/);
  assert.match(categoriesPage, /<CategoryManagementWorkspace/);
  assert.doesNotMatch(categoriesPage, /\.from\("products"\)/);
  assert.match(workspace, /view === "grid" \? <CategoryGrid/);
  assert.match(workspace, /<CategoryList/);
  assert.match(workspace, /<EditCategoryButton/);
  assert.match(workspace, /<CategoryArchiveButton/);
  assert.match(workspace, /<GuardedDeleteDialog/);
  assert.match(workspace, />Status<\/th>/);
  assert.match(workspace, />Order<\/th>/);
  assert.match(workspace, />Actions<\/th>/);
});

test("Category list is responsive without a page-level horizontal scroll", () => {
  assert.match(workspace, /grid gap-3 md:hidden/);
  assert.match(workspace, /hidden overflow-hidden rounded-xl border bg-card md:block/);
  assert.doesNotMatch(workspace, /min-w-\d+.*Category/);
});

test("Inventory Stock reuses the same global toggle instead of a second icon control", () => {
  assert.match(inventoryStock, /import \{ GridListViewToggle \}/);
  assert.match(inventoryStock, /<GridListViewToggle onChange=\{updateLayout\} value=\{layout\} \/>/);
  assert.doesNotMatch(inventoryStock, /<Grid2X2 aria-hidden/);
  assert.doesNotMatch(inventoryStock, /<List aria-hidden/);
});
