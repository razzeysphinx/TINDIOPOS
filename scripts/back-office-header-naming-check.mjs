import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

const [header, shell, navigation, inventoryPage, inventoryWorkflows, reportsPage] = await Promise.all([
  source("src/components/back-office/page-header.tsx"),
  source("src/components/back-office/back-office-workspace-shell.tsx"),
  source("src/components/back-office/back-office-navigation.tsx"),
  source("src/app/(back-office)/back-office/inventory/page.tsx"),
  source("src/features/inventory/advanced-inventory-workflows.tsx"),
  source("src/app/(back-office)/back-office/reports/page.tsx"),
]);

test("standard page headers use breadcrumbs plus a screen-reader H1 without legacy eyebrows", () => {
  assert.match(header, /<BackOfficeBreadcrumbs currentLabel=\{title\}/);
  assert.match(header, /<h1 className="sr-only">\{title\}<\/h1>/);
  assert.match(header, /showTitle = false/);
  assert.match(header, /showDescription = false/);
  assert.doesNotMatch(header, /\{eyebrow \? \(/);
});

test("the application header keeps the current page title at every width", () => {
  assert.match(shell, /getBackOfficePageTitle\(pathname\)/);
  assert.match(shell, /sm:text-base">/);
  assert.doesNotMatch(shell, /sm:text-base lg:hidden/);
});

test("sidebar and breadcrumbs use the simplified Back Office vocabulary", () => {
  for (const label of [
    "Business Reports",
    "Shift Reports",
    "Receipts",
    "Stock Control",
    "Customers & Loyalty",
    "Roles & Access",
    "Time & Attendance",
    "Approvals & Audit",
    "POS Devices",
    "Offline Sync",
  ]) {
    assert.match(navigation, new RegExp(`label: "${label}"`));
  }
  assert.doesNotMatch(navigation, /label: "Receipts & returns"/);
  assert.doesNotMatch(navigation, /label: "Inventory Control"/);
});

test("Stock Control and Purchasing do not repeat their page purpose in passive header elements", () => {
  assert.match(inventoryPage, /title=\{workspace === "purchasing" \? "Purchasing" : "Stock Control"\}/);
  assert.doesNotMatch(inventoryPage, /"Stock management"/);
  assert.doesNotMatch(inventoryPage, /"Purchasing access"/);
  assert.match(inventoryPage, /showHeader=\{false\}/);
  assert.match(inventoryWorkflows, /showHeader = true/);
  assert.match(inventoryWorkflows, /aria-label=\{showHeader \? undefined : "Purchasing operations"\}/);
  assert.doesNotMatch(reportsPage, /Organization reports/);
});
