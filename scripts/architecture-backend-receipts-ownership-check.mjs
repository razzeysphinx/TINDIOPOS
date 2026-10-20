import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Backend owns the bounded POS receipt-search read", async () => {
  const [route, service, owned, runtime, sharedRuntime, environment] = await Promise.all([
    read("apps/backend/api/pos/v2/receipts.ts"),
    read("apps/backend/src/pos/receipts-service.ts"),
    read("apps/backend/src/pos/receipts-owned.ts"),
    read("apps/backend/src/pos/receipts-runtime.ts"),
    read("apps/backend/src/pos/pos-read-runtime.ts"),
    read("apps/backend/.env.example"),
  ]);

  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /POST|PUT|PATCH|DELETE/);
  assert.match(route, /TINDIO_RECEIPTS_READ_MODE/);
  assert.match(service, /options\.mode \?\? ["']owned["']/);
  assert.match(owned, /handleOwnedPosReceipts/);
  assert.match(runtime, /get_pos_bootstrap_core_v2/);
  assert.match(runtime, /get_pos_receipt_history/);
  assert.match(sharedRuntime, /auth\.getClaims\(token\)/);
  assert.match(sharedRuntime, /createNeonDataApiFetch/);
  assert.match(environment, /^TINDIO_RECEIPTS_READ_MODE=owned$/m);
});

test("owned receipt search preserves permission, cursor, limit, and summary fields", async () => {
  const [owned, runtime] = await Promise.all([
    read("apps/backend/src/pos/receipts-owned.ts"),
    read("apps/backend/src/pos/receipts-runtime.ts"),
  ]);

  for (const value of [
    "pos.access",
    "sales.create",
    "receipts.view",
    "ORGANIZATION_INACTIVE",
    "INVALID_BUSINESS_TYPE",
    "The receipt search is invalid.",
    "INVALID_RECEIPTS_RESPONSE",
    "receipt_number",
    "refund_total_minor",
    "has_refundable_quantity",
    "payment_methods",
    "private, no-store",
    "x-tindio-request-id",
  ]) {
    assert.match(owned, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(runtime, /target_limit:\s*25/);
  assert.match(runtime, /target_before_receipt_number/);
  assert.doesNotMatch(`${owned}\n${runtime}`, /service[_-]?role|DATABASE_URL/i);
});

test("receipt-search rollback proxy is loop-safe, query-preserving, and allowlisted", async () => {
  const [service, proxy] = await Promise.all([
    read("apps/backend/src/pos/receipts-service.ts"),
    read("apps/backend/src/pos/receipts-proxy.ts"),
  ]);

  assert.match(service, /mode === ["']proxy["']/);
  assert.match(proxy, /POS_RECEIPTS_PATH\s*=\s*["']\/api\/pos\/v2\/receipts["']/);
  assert.match(proxy, /url\.search = requestUrl\.search/);
  assert.match(proxy, /upstream\.origin === requestUrl\.origin/);
  assert.match(proxy, /redirect:\s*["']manual["']/);
  assert.match(proxy, /cache:\s*["']no-store["']/);

  for (const header of [
    "accept",
    "authorization",
    "x-tindio-organization-id",
    "cache-control",
    "content-type",
    "retry-after",
    "x-tindio-request-id",
  ]) {
    assert.match(proxy, new RegExp(`["']${header}["']`));
  }
  assert.doesNotMatch(proxy, /headers\s*:\s*request\.headers|["']cookie["']/);
});

test("receipt search uses the focused cross-runtime receipt contract", async () => {
  const [manifestSource, owned] = await Promise.all([
    read("packages/contracts/package.json"),
    read("apps/backend/src/pos/receipts-owned.ts"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(manifest.exports["./receipts"].types, "./src/receipts.ts");
  assert.match(owned, /from ["']@tindio\/contracts\/receipts["']/);
  assert.doesNotMatch(owned, /from ["']@tindio\/contracts["']/);
});

test("Web receipt route and Mobile remain on the current origin", async () => {
  const [webRoute, mobileApi, detailRoute, deliveryRoute, refundRoute, readme] = await Promise.all([
    read("src/app/api/pos/v2/receipts/route.ts"),
    read("apps/mobile/src/lib/tindio-api.ts"),
    read("src/app/api/pos/v2/receipts/[receiptId]/route.ts"),
    read("src/app/api/pos/v2/receipts/[receiptId]/delivery/route.ts"),
    read("src/app/api/pos/v2/receipts/[receiptId]/refund/route.ts"),
    read("apps/backend/README.md"),
  ]);

  assert.match(webRoute, /loadPosReceiptHistory/);
  assert.match(mobileApi, /["'`]\/api\/pos\/v2\/receipts\?/);
  assert.doesNotMatch(mobileApi, /TINDIO_WEB_API_ORIGIN|apps\/backend/);
  assert.match(detailRoute, /loadPosReceiptDetail/);
  assert.match(deliveryRoute, /queueReceiptDelivery/);
  assert.match(refundRoute, /refundSale/);
  assert.match(readme, /No financial, custody, attendance, or offline-replayed mutation/);
});
