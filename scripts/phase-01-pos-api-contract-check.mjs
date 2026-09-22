import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const routeRoot = path.join(root, "src", "app", "api", "pos", "v1");

const requiredRoutes = [
  "bootstrap/route.ts",
  "cart/validate-stock/route.ts",
  "catalog/route.ts",
  "checkout/route.ts",
  "customer-display/route.ts",
  "customers/route.ts",
  "customers/create/route.ts",
  "device/route.ts",
  "favorites/route.ts",
  "modifiers/route.ts",
  "offline-checkout/route.ts",
  "shifts/open/route.ts",
  "shifts/close/route.ts",
  "shifts/cash-movement/route.ts",
  "tickets/save/route.ts",
  "tickets/cancel/route.ts",
  "tickets/move-lines/route.ts",
  "tickets/split/route.ts",
  "tickets/merge/route.ts",
  "receipts/route.ts",
  "receipts/[receiptId]/route.ts",
  "receipts/[receiptId]/refund/route.ts",
  "receipts/[receiptId]/delivery/route.ts",
  "attendance/employees/route.ts",
  "attendance/clock-in/route.ts",
  "attendance/clock-out/route.ts",
  "transfers/[transferId]/receive/route.ts",
  "stock-requests/[stockRequestId]/receive/route.ts",
  "approvals/request/route.ts",
  "approvals/[approvalRequestId]/route.ts",
  "approvals/[approvalRequestId]/approve/route.ts",
];

async function text(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("every required Phase 01 POS v1 route and supporting artifact exists", async () => {
  await Promise.all([
    ...requiredRoutes.map((route) => access(path.join(routeRoot, route))),
    access(path.join(root, "src/lib/auth/pos-api-context.ts")),
    access(path.join(root, "docs/mobile-program/PHASE_01_POS_API_MAP.md")),
  ]);
});

test("v1 routes use the centralized context boundary and never import Supabase directly", async () => {
  const sources = await Promise.all(requiredRoutes.map((route) => text(`src/app/api/pos/v1/${route}`)));
  for (const [index, source] of sources.entries()) {
    assert.doesNotMatch(source, /@\/lib\/supabase\/server/, `${requiredRoutes[index]} bypasses the POS API context/service boundary.`);
  }
  const nonAliases = sources.filter((source) => !/^export \{ \w+ \} from /m.test(source));
  for (const source of nonAliases) assert.match(source, /getPosApiBusinessContext/);
});

test("v1 mutations call shared services and do not import Server Actions", async () => {
  const mutationRoutes = requiredRoutes.filter((route) => ![
    "bootstrap/route.ts",
    "catalog/route.ts",
    "customers/route.ts",
    "modifiers/route.ts",
    "receipts/route.ts",
    "receipts/[receiptId]/route.ts",
    "attendance/employees/route.ts",
  ].includes(route));
  const sources = await Promise.all(mutationRoutes.map((route) => text(`src/app/api/pos/v1/${route}`)));
  for (const [index, source] of sources.entries()) {
    assert.doesNotMatch(source, /(?:ticket-actions|\/actions)["']/, `${mutationRoutes[index]} imports a Server Action.`);
  }
  assert.match(await text("src/app/api/pos/v1/checkout/route.ts"), /api\/pos\/checkout\/route/);
  assert.match(await text("src/app/api/pos/checkout/route.ts"), /completeCheckout/);
});

test("new shared services remain transport-neutral", async () => {
  const services = [
    "src/features/shifts/service.ts",
    "src/features/advanced-sales/ticket-service.ts",
    "src/features/receipts/service.ts",
    "src/features/inventory/pos-transfer-service.ts",
    "src/features/approvals/service.ts",
  ];
  for (const service of services) {
    const source = await text(service);
    assert.doesNotMatch(source, /next\/cache/, `${service} depends on web revalidation.`);
    assert.doesNotMatch(source, /revalidatePath/, `${service} contains presentation-layer revalidation.`);
  }
});

test("protected checkout and inventory architecture remains authoritative", async () => {
  const checkoutRoute = await text("src/app/api/pos/checkout/route.ts");
  const offlineRoute = await text("src/app/api/pos/offline-checkout/route.ts");
  const transferService = await text("src/features/inventory/pos-transfer-service.ts");
  assert.match(checkoutRoute, /@\/features\/checkout\/checkout-service/);
  assert.match(offlineRoute, /@\/features\/checkout\/checkout-service/);
  assert.doesNotMatch(transferService, /supabase\/migrations|checkout_advanced_sale/);
  assert.match(transferService, /receive_stock_transfer/);
  assert.match(transferService, /receive_stock_request/);
});

test("Phase 01 documents current-session auth and preserves the locked roadmap check", async () => {
  const map = await text("docs/mobile-program/PHASE_01_POS_API_MAP.md");
  const packageJson = JSON.parse(await text("package.json"));
  const sourceContract = await text("scripts/mobile-program-source-of-truth-check.mjs");
  assert.match(map, /CURRENT WEB SESSION ONLY/);
  assert.match(map, /DEFERRED TO PHASE 02/);
  assert.equal(packageJson.scripts["test:mobile-source-of-truth"], "node --test scripts/mobile-program-source-of-truth-check.mjs");
  assert.match(sourceContract, /Phase 00 through Phase 26/);
});
