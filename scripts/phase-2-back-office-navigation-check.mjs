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
  assert.match(reports, /label: "Business reports"/);
  assert.match(reports, /href: "\/back-office\/shifts"/);
  assert.doesNotMatch(reports, /href: "\/back-office\/reports\//);
});

test("Sales keeps receipt and return work together without adding a duplicate route", async () => {
  const navigation = await source("src/components/back-office/back-office-navigation.tsx");
  const sales = navigationGroup(navigation, "Sales");

  assert.match(sales, /href: "\/back-office\/receipts"/);
  assert.match(sales, /label: "Receipts & returns"/);
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

  assert.match(settings, /label: "Business profile & features"/);
  assert.match(settings, /label: "Advanced sales"/);
});

test("navigation remains permission-aware and inventory stays internally tabbed", async () => {
  const [navigation, inventory] = await Promise.all([
    source("src/components/back-office/back-office-navigation.tsx"),
    source("src/app/(back-office)/back-office/inventory/page.tsx"),
  ]);

  assert.match(navigation, /isVisible: \(access: BackOfficeNavigationAccess\) => boolean;/);
  assert.match(inventory, /const INVENTORY_TABS = \[/);
  assert.match(inventory, /href=\{`\/back-office\/inventory\?tab=\$\{tab\.id\}`\}/);
});
