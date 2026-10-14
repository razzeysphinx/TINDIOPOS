import assert from "node:assert/strict";

import {
  requireCanonicalProductionNeonTarget,
} from "./lib/canonical-production-neon-target.mjs";
import { runReadOnlySql } from "./lib/phase-04-postgres-docker.mjs";

const ORGANIZATION_ID = "baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9";
const STORE_ID = "8de6a6de-b006-403e-84eb-c1ac9b36e1c0";
const PRODUCT_NAME = "Phase 04F Certification Item";
const CONFLICT_PRICE_MINOR = 200;

const action = process.argv[2] ?? "status";
assert.ok(["status", "change", "restore"].includes(action), "Expected status, change, or restore.");
assert.equal(process.env.TINDIO_DATABASE_PROVIDER, "neon", "TINDIO_DATABASE_PROVIDER must be neon.");
const { databaseUrl } = requireCanonicalProductionNeonTarget(process.env.DATABASE_URL_UNPOOLED);

function required(name) {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} is required.`);
  return value;
}

function readSnapshot() {
  const localReference = process.env.TINDIO_A32_LOCAL_REFERENCE?.trim() ?? "";
  assert.ok(!localReference || /^OFF-[0-9A-F]{10}$/u.test(localReference), "TINDIO_A32_LOCAL_REFERENCE is invalid.");
  const localFilter = localReference
    ? `and event.local_receipt_reference='${localReference}'`
    : "and false";
  const sql = `select jsonb_build_object(
    'product',(select jsonb_build_object('id',product.id,'name',product.name,'priceMinor',product.price_minor,'status',product.status,'trackInventory',product.track_inventory) from public.products product where product.organization_id='${ORGANIZATION_ID}'::uuid and product.name='${PRODUCT_NAME}'),
    'storeSetting',(select jsonb_build_object('isAvailable',setting.is_available,'priceOverrideMinor',setting.price_override_minor,'restockPolicy',setting.restock_policy) from public.product_store_settings setting join public.products product on product.id=setting.product_id and product.organization_id=setting.organization_id where setting.organization_id='${ORGANIZATION_ID}'::uuid and setting.store_id='${STORE_ID}'::uuid and product.name='${PRODUCT_NAME}'),
    'financialCounts',jsonb_build_object(
      'sales',(select count(*) from public.sales where organization_id='${ORGANIZATION_ID}'::uuid),
      'payments',(select count(*) from public.payments where organization_id='${ORGANIZATION_ID}'::uuid),
      'receipts',(select count(*) from public.receipts where organization_id='${ORGANIZATION_ID}'::uuid),
      'saleItems',(select count(*) from public.sale_items where organization_id='${ORGANIZATION_ID}'::uuid),
      'inventoryMovements',(select count(*) from public.inventory_movements where organization_id='${ORGANIZATION_ID}'::uuid)
    ),
    'offlineEvent',(select jsonb_build_object('eventId',event.id,'idempotencyKey',event.idempotency_key,'deviceId',event.device_id,'deviceSequence',sequence.device_sequence,'sequenceState',sequence.state,'localReference',event.local_receipt_reference,'state',event.state,'conflictType',event.conflict_type,'officialReceiptNumber',event.official_receipt_number,'failureMessage',event.failure_message) from public.offline_sync_events event left join public.pos_device_sequence_receipts sequence on sequence.organization_id=event.organization_id and sequence.device_id=event.device_id and sequence.idempotency_key=event.idempotency_key where event.organization_id='${ORGANIZATION_ID}'::uuid ${localFilter} order by event.created_at desc limit 1),
    'authoritativeEffect',(select jsonb_build_object(
      'checkoutRequestCount',(select count(*) from public.advanced_checkout_requests candidate where candidate.organization_id=request.organization_id and candidate.idempotency_key=request.idempotency_key),
      'checkoutRequestState',request.state,
      'saleId',sale.id,
      'saleStatus',sale.status,
      'saleTotalMinor',sale.total_minor,
      'paymentCount',(select count(*) from public.payments payment where payment.organization_id=request.organization_id and payment.sale_id=request.sale_id),
      'paymentTotalMinor',(select coalesce(sum(payment.amount_minor),0) from public.payments payment where payment.organization_id=request.organization_id and payment.sale_id=request.sale_id),
      'receiptCount',(select count(*) from public.receipts receipt where receipt.organization_id=request.organization_id and receipt.sale_id=request.sale_id),
      'officialReceiptNumber',(select min(receipt.receipt_number) from public.receipts receipt where receipt.organization_id=request.organization_id and receipt.sale_id=request.sale_id),
      'saleItemCount',(select count(*) from public.sale_items item where item.organization_id=request.organization_id and item.sale_id=request.sale_id),
      'saleItemTotalMinor',(select coalesce(sum(item.line_total_minor),0) from public.sale_items item where item.organization_id=request.organization_id and item.sale_id=request.sale_id),
      'inventoryMovementCount',(select count(*) from public.inventory_movements movement where movement.organization_id=request.organization_id and movement.source_type='sale' and movement.source_id=request.sale_id),
      'inventoryDelta',(select coalesce(sum(movement.quantity_delta),0) from public.inventory_movements movement where movement.organization_id=request.organization_id and movement.source_type='sale' and movement.source_id=request.sale_id)
    ) from public.advanced_checkout_requests request join public.sales sale on sale.organization_id=request.organization_id and sale.id=request.sale_id join public.offline_sync_events event on event.organization_id=request.organization_id and event.idempotency_key=request.idempotency_key where request.organization_id='${ORGANIZATION_ID}'::uuid ${localFilter} limit 1),
    'audit',(select coalesce(jsonb_agg(jsonb_build_object('action',log.event_type,'details',log.metadata,'createdAt',log.created_at) order by log.created_at desc),'[]'::jsonb) from (select * from public.audit_logs where organization_id='${ORGANIZATION_ID}'::uuid and event_type='PRODUCT_STORE_CONFIGURATION_UPDATED' order by created_at desc limit 4) log)
  )::text;`;
  return JSON.parse(runReadOnlySql(databaseUrl, sql));
}

async function authenticate(emailName, passwordName) {
  const response = await fetch(`${required("NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/u, "")}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: required(emailName),
      password: required(passwordName),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  assert.equal(response.status, 200, `Certification authentication failed with ${response.status}.`);
  assert.equal(typeof body.access_token, "string", "Certification authentication returned no access token.");
  return body.access_token;
}

async function setPriceOverride(productId, value, restockPolicy) {
  const credentialNames = [
    ["TINDIO_PHASE_04_TEST_EMAIL", "TINDIO_PHASE_04_TEST_PASSWORD"],
    ["TINDIO_PHASE_05_TEST_EMAIL", "TINDIO_PHASE_05_TEST_PASSWORD"],
  ].filter(([emailName, passwordName]) => process.env[emailName]?.trim() && process.env[passwordName]?.trim());
  assert.ok(credentialNames.length > 0, "No certification credentials are configured.");
  const attempts = [];
  for (const [emailName, passwordName] of credentialNames) {
    const token = await authenticate(emailName, passwordName);
    const response = await fetch(`${required("NEON_DATA_API_URL").replace(/\/$/u, "")}/rpc/set_catalog_product_store_configuration_v3`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        target_organization_id: ORGANIZATION_ID,
        target_product_id: productId,
        target_store_id: STORE_ID,
        target_price_override_minor: value,
        target_restock_policy: restockPolicy,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    await response.text();
    if (response.status === 200 || response.status === 204) return;
    attempts.push(`${emailName}:${response.status}`);
  }
  assert.fail(`No configured certification identity was authorized for the canonical product RPC (${attempts.join(", ")}).`);
}

const before = readSnapshot();
assert.equal(before.product?.name, PRODUCT_NAME, "Dedicated A32 certification product is unavailable.");
assert.equal(before.product.status, "active", "Dedicated A32 certification product must be active.");
assert.equal(before.storeSetting?.isAvailable, true, "Dedicated A32 product must be available in Certification Store.");
assert.equal(before.product.priceMinor, 100, "A32 fixture organization price must remain PHP 1.00.");

if (action === "change") {
  assert.equal(before.storeSetting.priceOverrideMinor, null, "A32 price-change setup requires the normal store price.");
  await setPriceOverride(before.product.id, CONFLICT_PRICE_MINOR, before.storeSetting.restockPolicy);
} else if (action === "restore") {
  assert.equal(before.storeSetting.priceOverrideMinor, CONFLICT_PRICE_MINOR, "A32 restore requires the controlled PHP 2.00 override.");
  await setPriceOverride(before.product.id, null, before.storeSetting.restockPolicy);
}

const after = readSnapshot();
if (action === "change") assert.equal(after.storeSetting.priceOverrideMinor, CONFLICT_PRICE_MINOR);
if (action === "restore") assert.equal(after.storeSetting.priceOverrideMinor, null);
if (action !== "status") {
  assert.deepEqual(after.financialCounts, before.financialCounts, "Catalog mutation changed financial or inventory history.");
  assert.equal(after.audit[0]?.details?.product_id, before.product.id, "Canonical catalog audit did not identify the fixture product.");
  assert.equal(after.audit[0]?.details?.price_override_minor, action === "change" ? CONFLICT_PRICE_MINOR : null);
}

console.log(JSON.stringify({ action, before, after }));
