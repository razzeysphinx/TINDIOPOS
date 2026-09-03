import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

test("POS-only Cashiers are redirected before Back Office UI renders", async () => {
  const dal = await source("src/lib/auth/dal.ts");
  const backOfficePermissions = dal.slice(
    dal.indexOf("const BACK_OFFICE_PERMISSIONS"),
    dal.indexOf("export function hasAnyPermission"),
  );

  assert.doesNotMatch(backOfficePermissions, /sales\.create/);
  assert.match(
    dal,
    /if \(!canAccessBackOffice\(context\)\) \{\s*redirect\(getWorkspaceHome\(context\)\);\s*\}/,
  );
});

test("Cashier deep links named in the Phase 1 audit have server permission gates", async () => {
  const protectedRoutes = [
    ["src/app/(back-office)/back-office/catalog/page.tsx", "products.manage"],
    ["src/app/(back-office)/back-office/categories/page.tsx", "products.manage"],
    ["src/app/(back-office)/back-office/employees/page.tsx", "employees.manage"],
    ["src/app/(back-office)/back-office/roles/page.tsx", "roles.manage"],
    ["src/app/(back-office)/back-office/stores/page.tsx", "stores.manage"],
    ["src/app/(back-office)/back-office/registers/page.tsx", "registers.manage"],
  ];

  for (const [route, permission] of protectedRoutes) {
    const page = await source(route);
    assert.match(
      page,
      new RegExp(`requireBackOfficePermission\\("${permission}"\\)`),
      `${route} must require ${permission} on the server`,
    );
  }
});

test("dashboard and reports direct URLs use the same server route policy", async () => {
  for (const [route, permission] of [
    ["src/app/(back-office)/back-office/page.tsx", "dashboard.view"],
    ["src/app/(back-office)/back-office/reports/page.tsx", "reports.view"],
  ]) {
    const page = await source(route);
    assert.match(page, new RegExp(`requireBackOfficePermission\\("${permission}"\\)`));
  }
});

test("Back Office navigation cannot add an unguarded destination or a sidebar POS link", async () => {
  const navigation = await source("src/components/back-office/back-office-navigation.tsx");

  assert.match(
    navigation,
    /isVisible: \(access: BackOfficeNavigationAccess\) => boolean;/,
    "navigation items must declare a visibility predicate",
  );
  assert.doesNotMatch(navigation, /href:\s*["']\/pos["']/);
});

test("authorized Back Office users receive a separate POS workspace switch", async () => {
  const layout = await source("src/app/(back-office)/back-office/layout.tsx");

  assert.match(
    layout,
    /const canUsePos = context\.permissions\.includes\("pos\.access"\)\s*&& context\.permissions\.includes\("sales\.create"\);/,
  );
  assert.match(layout, /canUsePos \? \(\s*<Button[^>]*render=\{<Link href="\/pos" \/>\}/);
});
