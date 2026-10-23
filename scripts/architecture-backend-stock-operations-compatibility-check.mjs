import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("stock-operation contracts are focused and platform-neutral", async () => {
  const [manifestSource, index, checkout, receipt] = await Promise.all([read("packages/contracts/package.json"), read("packages/contracts/src/index.ts"), read("packages/contracts/src/checkout.ts"), read("packages/contracts/src/stock-request-receipt.ts")]);
  const manifest = JSON.parse(manifestSource);
  assert.equal(manifest.exports["./stock-request-receipt"].types, "./src/stock-request-receipt.ts");
  assert.match(index, /export \* from "\.\/stock-request-receipt"/);
  for (const value of ["POS_CART_STOCK_VALIDATION_PATH", "POS_CART_STOCK_VALIDATION_RPC", "POS_CART_STOCK_VALIDATION_PERMISSIONS", "validateCartStockSchema"]) assert.match(checkout, new RegExp(`\\b${value}\\b`));
  for (const value of ["POS_STOCK_REQUEST_RECEIPT_PATH_PATTERN", "POS_STOCK_REQUEST_RECEIPT_RPC", "receiveStockRequestSchema", "StockRequestReceiptResult"]) assert.match(receipt, new RegExp(`\\b${value}\\b`));
  for (const source of [checkout, receipt]) assert.doesNotMatch(source, /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/);
});

test("both Web routes retain context-first authority and shared contracts", async () => {
  const [cartRoute, receiptRoute, checkoutService, receiptService, schema] = await Promise.all([read("src/app/api/pos/v2/cart/validate-stock/route.ts"), read("src/app/api/pos/v2/stock-requests/[stockRequestId]/receive/route.ts"), read("src/features/checkout/checkout-service.ts"), read("src/features/inventory/pos-transfer-service.ts"), read("src/features/inventory/supply-chain-schema.ts")]);
  for (const source of [cartRoute, receiptRoute]) assert.match(source, /getPosV2BusinessContext\(request\)/);
  assert.ok(cartRoute.indexOf("getPosV2BusinessContext(request)") < cartRoute.indexOf("readPosApiJson(request)"));
  assert.ok(receiptRoute.indexOf("getPosV2BusinessContext(request)") < receiptRoute.indexOf("await params"));
  assert.ok(receiptRoute.indexOf("await params") < receiptRoute.indexOf("readPosApiJson(request)"));
  for (const marker of ["POS_CART_STOCK_VALIDATION_PERMISSIONS", "POS_CART_STOCK_VALIDATION_RPC", "validateCartStockSchema"]) assert.ok(checkoutService.includes(marker), `missing ${marker}`);
  for (const marker of ["POS_STOCK_REQUEST_RECEIPT_PERMISSION", "POS_STOCK_REQUEST_RECEIPT_RPC", "receiveStockRequestSchema"]) assert.ok(receiptService.includes(marker), `missing ${marker}`);
  assert.match(schema, /@tindio\/contracts\/stock-request-receipt/);
});

test("Backend stock oracle stays isolated and D48 creates no owned route or runtime mode", async () => {
  const oracle = await read("apps/backend/src/pos/stock-operations-compatibility.ts");
  for (const value of ["STOCK_OPERATIONS_COMPATIBILITY_CONTRACT", "validateCartStockOperation", "mapCartStockValidationResult", "validateStockRequestReceipt", "mapStockRequestReceiptResult"]) assert.match(oracle, new RegExp(`\\b${value}\\b`));
  assert.doesNotMatch(oracle, /fetch\(|createNeonDataApiFetch|@supabase|@neon|process\.env/);
  assert.equal(existsSync(new URL("../apps/backend/api/pos/v2/cart/validate-stock.ts", import.meta.url)), false);
  assert.equal(existsSync(new URL("../apps/backend/api/pos/v2/stock-requests/[stockRequestId]/receive.ts", import.meta.url)), false);
  assert.equal(existsSync(new URL("../apps/backend/src/pos/stock-operations-runtime.ts", import.meta.url)), false);
});

test("database authority retains stock policy, shift, destination, replay, discrepancy, and audit custody", async () => {
  const baseline = (await read("database/baseline/0001_tindio_baseline.sql")).toLowerCase();
  for (const marker of ["private.require_pos_capabilities", "array['pos.access', 'sales.create', 'payments.accept']", "private.resolve_negative_stock_policy", "shift.status = 'open'", "composite_inventory_mode = 'made_to_order'", "private.has_inventory_capability(target_organization_id, 'inventory.transfer.receive')", "request_row.requesting_store_id", "existing_receipt.operation_payload = normalized_lines", "private.receive_inventory_transfer_core", "insert into public.stock_request_discrepancies", "'received_with_discrepancy'", "private.write_audit_log"]) assert.ok(baseline.includes(marker), `missing ${marker}`);
  assert.ok(baseline.includes('grant all on function "public"."validate_pos_cart_stock"'));
  assert.ok(baseline.includes('grant all on function "public"."receive_stock_request"'));
});

test("D47 ownership remains while both final stock routes stay in Web", async () => {
  for (const path of ["request.ts", "[approvalRequestId].ts", "[approvalRequestId]/approve.ts"]) assert.equal(existsSync(new URL(`../apps/backend/api/pos/v2/approvals/${path}`, import.meta.url)), true);
  for (const path of ["src/app/api/pos/v2/cart/validate-stock/route.ts", "src/app/api/pos/v2/stock-requests/[stockRequestId]/receive/route.ts"]) assert.match(await read(path), /getPosV2BusinessContext/);
  assert.match(await read("apps/backend/README.md"), /Slice D48 stock-operation compatibility oracle/);
});
