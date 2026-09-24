import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const legacyRoutePrefix = ["/api", "pos", "v1"].join("/") + "/";
const legacyContext = ["getPos", "ApiBusinessContext"].join("");
const legacyWorkspaceLoader = ["loadPos", "Workspace"].join("");

async function exists(target) {
  try {
    await access(path.join(root, target));
    return true;
  } catch {
    return false;
  }
}

async function source(target) {
  return readFile(path.join(root, target), "utf8");
}

function grep(pattern) {
  try {
    return execFileSync("git", ["grep", "-n", pattern, "--", "src", "scripts"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

test("the legacy POS V1 API tree is retired", async () => {
  assert.equal(await exists("src/app/api/pos/v1"), false);
});

test("the shared POS contract is V2", async () => {
  assert.equal(await exists("src/contracts/pos-v1.ts"), false);
  assert.match(await source("src/contracts/pos.ts"), /TINDIO_POS_API_VERSION\s*=\s*["']v2["']/);
});

test("obsolete V1 bootstrap infrastructure has no active source references", () => {
  assert.equal(grep(legacyContext), "");
  assert.equal(grep(legacyWorkspaceLoader), "");
  assert.equal(grep(legacyRoutePrefix), "");
});

test("V2 includes required read and operational domains", async () => {
  const required = [
    "src/app/api/pos/v2/bootstrap/route.ts",
    "src/app/api/pos/v2/reference/route.ts",
    "src/app/api/pos/v2/live/route.ts",
    "src/app/api/pos/v2/catalog/route.ts",
    "src/app/api/pos/v2/modifiers/route.ts",
    "src/app/api/pos/v2/cart/validate-stock/route.ts",
    "src/app/api/pos/v2/checkout/route.ts",
    "src/app/api/pos/v2/offline-checkout/route.ts",
    "src/app/api/pos/v2/customer-display/route.ts",
    "src/app/api/pos/v2/customers/route.ts",
    "src/app/api/pos/v2/customers/create/route.ts",
    "src/app/api/pos/v2/device/route.ts",
    "src/app/api/pos/v2/favorites/route.ts",
    "src/app/api/pos/v2/shifts/open/route.ts",
    "src/app/api/pos/v2/shifts/close/route.ts",
    "src/app/api/pos/v2/shifts/cash-movement/route.ts",
    "src/app/api/pos/v2/tickets/save/route.ts",
    "src/app/api/pos/v2/tickets/cancel/route.ts",
    "src/app/api/pos/v2/tickets/move-lines/route.ts",
    "src/app/api/pos/v2/tickets/split/route.ts",
    "src/app/api/pos/v2/tickets/merge/route.ts",
    "src/app/api/pos/v2/receipts/route.ts",
    "src/app/api/pos/v2/receipts/[receiptId]/route.ts",
    "src/app/api/pos/v2/receipts/[receiptId]/refund/route.ts",
    "src/app/api/pos/v2/receipts/[receiptId]/delivery/route.ts",
    "src/app/api/pos/v2/attendance/employees/route.ts",
    "src/app/api/pos/v2/attendance/clock-in/route.ts",
    "src/app/api/pos/v2/attendance/clock-out/route.ts",
    "src/app/api/pos/v2/transfers/[transferId]/receive/route.ts",
    "src/app/api/pos/v2/stock-requests/[stockRequestId]/receive/route.ts",
    "src/app/api/pos/v2/approvals/request/route.ts",
    "src/app/api/pos/v2/approvals/[approvalRequestId]/route.ts",
    "src/app/api/pos/v2/approvals/[approvalRequestId]/approve/route.ts",
  ];

  for (const route of required) assert.equal(await exists(route), true, `${route} is missing`);
});

test("obsolete V1 deployed certifier is retired", async () => {
  assert.equal(await exists("scripts/phase-04-deployed-certification.mjs"), false);
  const packageJson = JSON.parse(await source("package.json"));
  assert.equal(Object.hasOwn(packageJson.scripts, "certify:phase-04:deployed"), false);
  assert.ok(Object.hasOwn(packageJson.scripts, "certify:phase-04:v2-final"));
});
