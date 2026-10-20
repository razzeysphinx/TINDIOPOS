import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Backend owns the immutable POS receipt-detail read", async () => {
  const [route, service, owned, runtime, sharedRuntime, environment] = await Promise.all([
    read("apps/backend/api/pos/v2/receipts/[receiptId].ts"),
    read("apps/backend/src/pos/receipt-detail-service.ts"),
    read("apps/backend/src/pos/receipt-detail-owned.ts"),
    read("apps/backend/src/pos/receipt-detail-runtime.ts"),
    read("apps/backend/src/pos/pos-read-runtime.ts"),
    read("apps/backend/.env.example"),
  ]);

  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /POST|PUT|PATCH|DELETE/);
  assert.match(route, /TINDIO_RECEIPT_DETAIL_READ_MODE/);
  assert.match(service, /options\.mode \?\? ["']owned["']/);
  assert.match(owned, /handleOwnedPosReceiptDetail/);
  assert.match(runtime, /get_pos_bootstrap_core_v2/);
  assert.match(runtime, /get_pos_receipt_detail/);
  assert.match(sharedRuntime, /auth\.getClaims\(token\)/);
  assert.match(sharedRuntime, /createNeonDataApiFetch/);
  assert.match(environment, /^TINDIO_RECEIPT_DETAIL_READ_MODE=owned$/m);
});

test("owned receipt detail preserves UUID, permission, 404, and snapshot fields", async () => {
  const owned = await read("apps/backend/src/pos/receipt-detail-owned.ts");

  for (const value of [
    "pos.access",
    "sales.create",
    "receipts.view",
    "This receipt is invalid.",
    "This receipt is unavailable.",
    "INVALID_RECEIPT_RESPONSE",
    "customerEmail",
    "organizationName",
    "unitPriceMinor",
    "tenderedMinor",
    "paymentReference",
    "saleItemId",
    "private, no-store",
    "x-tindio-request-id",
  ]) {
    assert.match(owned, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(owned, /RECEIPT_DETAIL_PATH_PATTERN/);
  assert.doesNotMatch(owned, /service[_-]?role|DATABASE_URL/i);
});

test("receipt-detail rollback preserves one dynamic read path and excludes mutations", async () => {
  const [service, proxy] = await Promise.all([
    read("apps/backend/src/pos/receipt-detail-service.ts"),
    read("apps/backend/src/pos/receipt-detail-proxy.ts"),
  ]);

  assert.match(service, /mode === ["']proxy["']/);
  assert.match(proxy, /POS_RECEIPT_DETAIL_PATH_PATTERN/);
  assert.match(proxy, /new URL\(requestUrl\.pathname, upstream\.origin\)/);
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

test("receipt detail uses the focused cross-runtime receipt contract", async () => {
  const [manifestSource, owned] = await Promise.all([
    read("packages/contracts/package.json"),
    read("apps/backend/src/pos/receipt-detail-owned.ts"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(manifest.exports["./receipts"].types, "./src/receipts.ts");
  assert.match(owned, /from ["']@tindio\/contracts\/receipts["']/);
  assert.doesNotMatch(owned, /from ["']@tindio\/contracts["']/);
});

test("Web rollback route remains authoritative and mutations stay in Next.js", async () => {
  const [detailRoute, deliveryRoute, refundRoute, mobileApi, readme] = await Promise.all([
    read("src/app/api/pos/v2/receipts/[receiptId]/route.ts"),
    read("src/app/api/pos/v2/receipts/[receiptId]/delivery/route.ts"),
    read("src/app/api/pos/v2/receipts/[receiptId]/refund/route.ts"),
    read("apps/mobile/src/lib/tindio-api.ts"),
    read("apps/backend/README.md"),
  ]);

  assert.match(detailRoute, /loadPosReceiptDetail/);
  assert.match(deliveryRoute, /queueReceiptDelivery/);
  assert.match(refundRoute, /refundSale/);
  assert.doesNotMatch(mobileApi, /TINDIO_WEB_API_ORIGIN|apps\/backend/);
  assert.match(readme, /No financial, custody, attendance, or offline-replayed mutation/);
});
