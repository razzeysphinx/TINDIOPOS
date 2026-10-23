import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Backend owns exactly the two D48-frozen stock-operation routes", async () => {
  const [cart, receipt] = await Promise.all([read("apps/backend/api/pos/v2/cart/validate-stock.ts"), read("apps/backend/api/pos/v2/stock-requests/[stockRequestId]/receive.ts")]);
  for (const source of [cart, receipt]) {
    assert.match(source, /export async function POST/); assert.doesNotMatch(source, /export async function GET/);
    assert.match(source, /TINDIO_STOCK_OPERATIONS_MODE/); assert.match(source, /TINDIO_WEB_API_ORIGIN/);
  }
  assert.match(await read("apps/backend/.env.example"), /^TINDIO_STOCK_OPERATIONS_MODE=owned$/m);
});

test("owned stock operations preserve context-first authorization and route-specific ordering", async () => {
  const source = await read("apps/backend/src/pos/stock-operations-owned.ts");
  for (const value of ["verifyClaims", "loadCore", "IDENTITY_UNMAPPED", "validateCartStockOperation", "validateStockRequestReceiptId", "validateStockRequestReceipt", "mapCartStockValidationResult", "mapStockRequestReceiptResult"]) assert.ok(source.includes(value), `missing ${value}`);
  assert.ok(source.indexOf("dependencies.verifyClaims(token)") < source.indexOf("dependencies.loadCore(token"));
  assert.ok(source.indexOf("const context = await loadContext(request") < source.indexOf("body = await request.json()"));
  assert.ok(source.indexOf("validateStockRequestReceiptId(") < source.indexOf("body = await request.json()"));
  assert.doesNotMatch(source, /service[_-]?role|DATABASE_URL/i);
});

test("stock-operation runtime keeps Auth at Supabase and both RPCs at Neon", async () => {
  const [runtime, owned] = await Promise.all([read("apps/backend/src/pos/stock-operations-runtime.ts"), read("apps/backend/src/pos/stock-operations-owned.ts")]);
  assert.match(runtime, /auth\.auth\.getClaims\(token\)/); assert.match(runtime, /createNeonDataApiFetch/);
  for (const marker of ["get_pos_bootstrap_core_v2", "STOCK_OPERATION_RPCS.validateCart", "STOCK_OPERATION_RPCS.receiveRequest", "stockOperationRpcArguments.validateCart", "stockOperationRpcArguments.receiveRequest"]) assert.ok(runtime.includes(marker), `missing ${marker}`);
  for (const marker of ["POS_CART_STOCK_VALIDATION_RPC", "POS_STOCK_REQUEST_RECEIPT_RPC"]) assert.ok(owned.includes(marker), `missing ${marker}`);
  assert.doesNotMatch(runtime, /service[_-]?role|DATABASE_URL/i);
});

test("stock-operation rollback allowlists two POST paths without ambient credentials", async () => {
  const source = await read("apps/backend/src/pos/stock-operations-proxy.ts");
  for (const marker of ["POS_CART_STOCK_VALIDATION_PATH", "POS_STOCK_REQUEST_RECEIPT_PATH_PATTERN", "request.arrayBuffer()", 'method === "POST"', 'redirect: "manual"', 'cache: "no-store"']) assert.ok(source.includes(marker), `missing ${marker}`);
  assert.doesNotMatch(source, /headers\s*:\s*request\.headers|["']cookie["']|["']x-tindio-device-secret["']/);
});

test("D49 retains Web rollback and leaves database, clients, and D47 ownership unchanged", async () => {
  for (const path of ["src/app/api/pos/v2/cart/validate-stock/route.ts", "src/app/api/pos/v2/stock-requests/[stockRequestId]/receive/route.ts"]) assert.match(await read(path), /getPosV2BusinessContext\(request\)/);
  for (const path of ["request.ts", "[approvalRequestId].ts", "[approvalRequestId]/approve.ts"]) assert.match(await read(`apps/backend/api/pos/v2/approvals/${path}`), /TINDIO_APPROVAL_CONTROL_MODE/);
  const packageJson = JSON.parse(await read("package.json"));
  assert.ok(packageJson.scripts["test:architecture-backend-stock-operations"]);
  assert.match(await read("apps/backend/README.md"), /Slice D49 Backend-owned stock operations/);
});
