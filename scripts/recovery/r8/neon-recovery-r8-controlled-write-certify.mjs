import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { runReadOnlySql } from "../../lib/phase-04-postgres-docker.mjs";
import { targetUrl } from "../r7/common.mjs";
import { TARGET_DATA_API_HOST, writeR8Evidence } from "./common.mjs";

function required(name) {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} is required.`);
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function uuid(value, label) {
  assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu, `${label} must be a UUID.`);
  return value;
}

function money(minor) {
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}

assert.equal(required("TINDIO_R8_CONTROLLED_WRITE"), "YES", "R8 controlled production write authorization is required.");
assert.ok(!process.env.TINDIO_CUTOVER_BYPASS_SECRET, "Controlled writes must run without the maintenance bypass.");

const deployment = new URL(required("TINDIO_PHASE_04_DEPLOYMENT_URL"));
assert.equal(deployment.hostname, "tindiopos.vercel.app", "Controlled writes must use the production alias.");
const dataApi = new URL(required("NEON_DATA_API_URL"));
assert.equal(dataApi.hostname, TARGET_DATA_API_HOST, "Controlled writes must use the recovered target Data API.");
assert.equal(dataApi.pathname, "/tindio_r6_recovery/rest/v1", "Controlled writes must use the recovered target database.");

const supabase = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const { data: auth, error: authError } = await supabase.auth.signInWithPassword({
  email: required("TINDIO_PHASE_04_TEST_EMAIL"),
  password: required("TINDIO_PHASE_04_TEST_PASSWORD"),
});
assert.equal(authError, null, `Certification sign-in failed: ${authError?.message ?? "unknown"}`);
assert.ok(auth.session?.access_token, "Certification sign-in returned no session.");

const headers = {
  Authorization: `Bearer ${auth.session.access_token}`,
  Accept: "application/json",
  "Content-Type": "application/json",
  ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim()
    ? { "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET.trim() }
    : {}),
};

async function request(path, init = {}) {
  const response = await fetch(new URL(path, deployment), {
    ...init,
    headers: { ...headers, ...init.headers },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  assert.equal(response.status, 200, `${init.method ?? "GET"} ${path} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function dataApiRpc(name, body) {
  const base = required("NEON_DATA_API_URL").replace(/\/?$/u, "/");
  const response = await fetch(new URL(`rpc/${name}`, base), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.session.access_token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  const result = text ? JSON.parse(text) : null;
  assert.ok(response.status === 200 || response.status === 204, `Data API RPC ${name} returned ${response.status}: ${JSON.stringify(result)}`);
  return result;
}

const target = targetUrl();
function targetJson(sql) {
  return JSON.parse(runReadOnlySql(target, `select result::text from (${sql.trim().replace(/;$/u, "")}) as query(result);`));
}

try {
  const bootstrap = await request("/api/pos/v2/bootstrap");
  assert.equal(bootstrap.ok, true);
  const organizationId = uuid(bootstrap.core.organization.id, "organizationId");
  const activeShift = bootstrap.core.activeShift;
  assert.ok(activeShift, "The certification identity must have an active shift.");
  const storeId = uuid(activeShift.storeId, "storeId");
  const registerId = uuid(activeShift.registerId, "registerId");

  const reference = await request(`/api/pos/v2/reference`, {
    headers: { "X-Tindio-Organization-Id": organizationId },
  });
  const cash = reference.reference.paymentMethods.find((method) => method.storeId === storeId && method.type === "CASH");
  assert.ok(cash, "The certification store must have an active cash payment method.");
  uuid(cash.id, "paymentMethodId");

  const catalog = await request(`/api/pos/v2/catalog?store=${storeId}&mode=search&offset=0&limit=24`, {
    headers: { "X-Tindio-Organization-Id": organizationId },
  });
  const candidates = catalog.items.filter((item) => item.productName === "Phase 04F Certification Item"
    && item.priceMinor > 0 && !item.isVariablePrice && !item.hasModifiers);
  assert.ok(candidates.length > 0, `No explicit Phase 14 fixed-price certification fixture is available. Sanitized catalog descriptors: ${JSON.stringify(catalog.items.map((item) => ({ name: item.productName, fixedPrice: !item.isVariablePrice, hasModifiers: Boolean(item.hasModifiers), pricePositive: item.priceMinor > 0 })))}`);

  let selected = null;
  const candidateStates = [];
  for (const item of candidates) {
    uuid(item.productId, "candidate productId");
    if (item.variantId) uuid(item.variantId, "candidate variantId");
    const variant = item.variantId ? `'${item.variantId}'::uuid` : "null::uuid";
    const state = targetJson(`select jsonb_build_object(
      'tracked',p.track_inventory,
      'quantity',coalesce((select il.quantity from public.inventory_levels il where il.organization_id='${organizationId}'::uuid and il.store_id='${storeId}'::uuid and il.product_id=p.id and il.variant_id is not distinct from ${variant}),0)
    ) from public.products p where p.organization_id='${organizationId}'::uuid and p.id='${item.productId}'::uuid`);
    candidateStates.push({ tracked: state.tracked, quantity: Number(state.quantity) });
    if (state.tracked && Number(state.quantity) >= 0) {
      selected = { ...item, quantityBefore: Number(state.quantity) };
      break;
    }
  }
  assert.ok(selected, `No in-stock tracked production certification fixture is available: ${JSON.stringify(candidateStates)}`);

  function snapshot() {
    const variant = selected.variantId ? `'${selected.variantId}'::uuid` : "null::uuid";
    return targetJson(`select jsonb_build_object(
      'sales',(select count(*) from public.sales where organization_id='${organizationId}'::uuid),
      'saleItems',(select count(*) from public.sale_items where organization_id='${organizationId}'::uuid),
      'payments',(select count(*) from public.payments where organization_id='${organizationId}'::uuid),
      'receipts',(select count(*) from public.receipts where organization_id='${organizationId}'::uuid),
      'refunds',(select count(*) from public.refunds where organization_id='${organizationId}'::uuid),
      'refundItems',(select count(*) from public.refund_items where organization_id='${organizationId}'::uuid),
      'refundPayments',(select count(*) from public.refund_payments where organization_id='${organizationId}'::uuid),
      'checkoutRequests',(select count(*) from public.checkout_requests where organization_id='${organizationId}'::uuid),
      'refundRequests',(select count(*) from public.refund_requests where organization_id='${organizationId}'::uuid),
      'inventoryCounts',(select count(*) from public.inventory_counts where organization_id='${organizationId}'::uuid),
      'inventoryCountLines',(select count(*) from public.inventory_count_lines where organization_id='${organizationId}'::uuid),
      'productMovements',(select count(*) from public.inventory_movements where organization_id='${organizationId}'::uuid and product_id='${selected.productId}'::uuid and variant_id is not distinct from ${variant}),
      'quantity',(select quantity from public.inventory_levels where organization_id='${organizationId}'::uuid and store_id='${storeId}'::uuid and product_id='${selected.productId}'::uuid and variant_id is not distinct from ${variant})
    )`);
  }

  const before = snapshot();
  assert.equal(Number(before.quantity), 0, "The production certification fixture activation baseline must remain zero.");

  async function postSelectedCount({ countedQuantity, note, operationId }) {
    const existing = targetJson(`select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status) order by started_at),'[]'::jsonb)
      from public.inventory_counts
      where organization_id='${organizationId}'::uuid and store_id='${storeId}'::uuid and note='${note}'`);
    assert.ok(existing.length <= 1, `Expected at most one resumable count for ${note}.`);
    const createdNow = existing.length === 0;
    const countId = uuid(createdNow
      ? await dataApiRpc("create_inventory_count_plan_v2", {
        target_organization_id: organizationId,
        target_store_id: storeId,
        target_note: note,
        target_count_mode: "standard",
        target_scope_type: "selected",
        target_selected_items: [{ product_id: selected.productId, variant_id: selected.variantId }],
        target_sort_mode: "product_name",
        target_include_zero_stock: true,
        target_scope_reference_id: null,
      })
      : existing[0].id, "inventoryCountId");
    const startingStatus = createdNow ? "draft" : existing[0].status;
    const postedNow = !["posted", "completed"].includes(startingStatus);
    assert.ok(!["cancelled"].includes(startingStatus), "A cancelled certification count cannot be resumed.");
    if (!["ready_for_review", "posted", "completed"].includes(startingStatus)) {
      await dataApiRpc("save_inventory_count_line_v2", {
        target_organization_id: organizationId,
        target_inventory_count_id: countId,
        target_product_id: selected.productId,
        target_counted_quantity: countedQuantity,
        target_variant_id: selected.variantId,
      });
      await dataApiRpc("submit_inventory_count_for_review", {
        target_organization_id: organizationId,
        target_inventory_count_id: countId,
      });
    }
    const postBody = {
      target_organization_id: organizationId,
      target_inventory_count_id: countId,
      target_operation_id: operationId,
    };
    await dataApiRpc("post_inventory_count", postBody);
    await dataApiRpc("post_inventory_count", postBody);
    return { countId, createdNow, postedNow };
  }

  const stockInCount = await postSelectedCount({
    countedQuantity: 1,
    note: "R8 controlled production certification stock-in",
    operationId: "8f8c51d2-683d-4c8c-9be7-e6e461be8a03",
  });
  const stockInCountId = stockInCount.countId;
  const stocked = snapshot();
  if (stockInCount.postedNow) {
    assert.equal(Number(stocked.quantity), 1, "The certification count must establish exactly one unit.");
  }
  assert.equal(Number(stocked.inventoryCounts) - Number(before.inventoryCounts), Number(stockInCount.createdNow));
  assert.equal(Number(stocked.inventoryCountLines) - Number(before.inventoryCountLines), Number(stockInCount.createdNow));

  const stockValidation = stockInCount.postedNow
    ? await request("/api/pos/v2/cart/validate-stock", {
      method: "POST",
      body: JSON.stringify({
        storeId,
        registerId,
        items: [{ productId: selected.productId, variantId: selected.variantId, quantity: 1 }],
      }),
      headers: { "X-Tindio-Organization-Id": organizationId },
    })
    : { ok: true, items: [], policy: "block" };
  assert.equal(stockValidation.ok, true);
  assert.equal(stockValidation.items.length, 0, "Certification stock validation must have no negative projection.");
  const checkoutKey = "8f8c51d2-683d-4c8c-9be7-e6e461be8a01";
  const checkoutBody = {
    checkout: {
      storeId,
      registerId,
      idempotencyKey: checkoutKey,
      customerId: null,
      loyaltyRedemptionPoints: 0,
      discountId: null,
      taxRateId: null,
      diningOptionId: null,
      openTicketId: null,
      items: [{
        productId: selected.productId,
        variantId: selected.variantId,
        quantity: 1,
        modifierOptionIds: [],
        itemNote: "R8 controlled production certification",
      }],
      payments: [{
        paymentMethodId: cash.id,
        tenderedAmount: money(selected.priceMinor),
        referenceNumber: "",
        note: "R8 controlled production certification",
      }],
    },
    device: null,
  };
  const checkout = await request("/api/pos/v2/checkout", { method: "POST", body: JSON.stringify(checkoutBody), headers: { "X-Tindio-Organization-Id": organizationId } });
  assert.equal(checkout.ok, true);
  assert.equal(checkout.data.totalMinor, selected.priceMinor);
  uuid(checkout.data.saleId, "saleId");
  const checkoutReplay = await request("/api/pos/v2/checkout", { method: "POST", body: JSON.stringify(checkoutBody), headers: { "X-Tindio-Organization-Id": organizationId } });
  assert.equal(checkoutReplay.ok, true);
  assert.equal(checkoutReplay.data.wasReplayed, true);
  assert.equal(checkoutReplay.data.saleId, checkout.data.saleId);

  const receipts = await request("/api/pos/v2/receipts", { headers: { "X-Tindio-Organization-Id": organizationId } });
  const receipt = receipts.receipts.find((item) => item.sale_id === checkout.data.saleId);
  assert.ok(receipt, "Controlled sale receipt was not returned by the production API.");
  uuid(receipt.receipt_id, "receiptId");
  const detail = await request(`/api/pos/v2/receipts/${receipt.receipt_id}`, { headers: { "X-Tindio-Organization-Id": organizationId } });
  assert.equal(detail.sale.id, checkout.data.saleId);
  assert.equal(detail.items.length, 1);
  assert.equal(detail.payments.length, 1);

  const refundKey = "8f8c51d2-683d-4c8c-9be7-e6e461be8a02";
  const refundBody = {
    paymentMethodId: cash.id,
    idempotencyKey: refundKey,
    reason: "R8 controlled production certification",
    referenceNumber: "R8-CERTIFICATION",
    items: [{ saleItemId: detail.items[0].id, quantity: 1, returnToStock: true }],
  };
  const refund = await request(`/api/pos/v2/receipts/${receipt.receipt_id}/refund`, { method: "POST", body: JSON.stringify(refundBody), headers: { "X-Tindio-Organization-Id": organizationId } });
  assert.equal(refund.ok, true);
  const refundReplay = await request(`/api/pos/v2/receipts/${receipt.receipt_id}/refund`, { method: "POST", body: JSON.stringify(refundBody), headers: { "X-Tindio-Organization-Id": organizationId } });
  assert.equal(refundReplay.ok, true);
  assert.equal(refundReplay.data.wasReplayed, true);
  assert.equal(refundReplay.data.refundId, refund.data.refundId);

  const stockOutCount = await postSelectedCount({
    countedQuantity: 0,
    note: "R8 controlled production certification cleanup",
    operationId: "8f8c51d2-683d-4c8c-9be7-e6e461be8a04",
  });
  const stockOutCountId = stockOutCount.countId;

  const after = snapshot();
  const checkoutDelta = checkout.data.wasReplayed ? 0 : 1;
  const refundDelta = refund.data.wasReplayed ? 0 : 1;
  const expectedDeltas = {
    sales: checkoutDelta,
    saleItems: checkoutDelta,
    payments: checkoutDelta,
    receipts: checkoutDelta,
    refunds: refundDelta,
    refundItems: refundDelta,
    refundPayments: refundDelta,
    checkoutRequests: checkoutDelta,
    refundRequests: refundDelta,
    inventoryCounts: Number(stockInCount.createdNow) + Number(stockOutCount.createdNow),
    inventoryCountLines: Number(stockInCount.createdNow) + Number(stockOutCount.createdNow),
    productMovements: checkoutDelta + refundDelta + Number(stockInCount.postedNow) + Number(stockOutCount.postedNow),
  };
  for (const [name, delta] of Object.entries(expectedDeltas)) {
    assert.equal(Number(after[name]) - Number(before[name]), delta, `${name} delta must be ${delta}.`);
  }
  assert.equal(Number(after.quantity), Number(before.quantity), "Controlled write certification must restore the activation-baseline quantity.");

  const committed = targetJson(`select jsonb_build_object(
    'firstBusinessWriteAt',(select least(
      (select started_at from public.inventory_counts where id='${stockInCountId}'::uuid),
      (select completed_at from public.sales where id='${checkout.data.saleId}'::uuid)
    )),
    'saleStatus',(select status from public.sales where id='${checkout.data.saleId}'::uuid),
    'refundStatus',(select status from public.refunds where id='${uuid(refund.data.refundId, "refundId")}'::uuid),
    'saleShiftId',(select shift_id from public.sales where id='${checkout.data.saleId}'::uuid),
    'refundShiftId',(select shift_id from public.refunds where id='${refund.data.refundId}'::uuid),
    'postedCounts',(select count(*) from public.inventory_counts where id in ('${stockInCountId}'::uuid,'${stockOutCountId}'::uuid) and status in ('posted','completed')),
    'certificationMovements',(select count(*) from public.inventory_movements where
      (source_type='inventory_count' and source_id in ('${stockInCountId}'::uuid,'${stockOutCountId}'::uuid))
      or (source_type='sale' and source_id='${checkout.data.saleId}'::uuid)
      or (source_type='refund' and source_id='${refund.data.refundId}'::uuid)),
    'receiptLinks',(select count(*) from public.receipts where sale_id='${checkout.data.saleId}'::uuid),
    'paymentLinks',(select count(*) from public.payments where sale_id='${checkout.data.saleId}'::uuid),
    'refundLinks',(select count(*) from public.refunds where sale_id='${checkout.data.saleId}'::uuid)
  )`);
  assert.equal(committed.saleStatus, "completed");
  assert.equal(committed.refundStatus, "completed");
  assert.equal(committed.saleShiftId, activeShift.id);
  assert.equal(committed.refundShiftId, activeShift.id);
  assert.equal(Number(committed.postedCounts), 2);
  assert.equal(Number(committed.certificationMovements), 4);
  assert.deepEqual({ receiptLinks: Number(committed.receiptLinks), paymentLinks: Number(committed.paymentLinks), refundLinks: Number(committed.refundLinks) }, { receiptLinks: 1, paymentLinks: 1, refundLinks: 1 });

  const evidence = {
    generatedAt: new Date().toISOString(),
    status: "PASS",
    deploymentHost: deployment.hostname,
    targetDataApiHost: dataApi.hostname,
    fixtureContract: "existing tracked Phase 04F Certification Item only",
    fixtureIdentitySha256: sha256(`${selected.productId}:${selected.variantId ?? "simple"}`),
    saleIdentitySha256: sha256(checkout.data.saleId),
    refundIdentitySha256: sha256(refund.data.refundId),
    firstBusinessAuthoritativeTargetWrite: committed.firstBusinessWriteAt,
    checkout: { committed: true, replayWasNoOp: true },
    receiptAndPaymentLinkage: "PASS",
    refund: { committed: true, separateFromSale: true, replayWasNoOp: true, returnedToStock: true },
    certificationFootprint: {
      inventoryCounts: 2,
      inventoryCountLines: 2,
      sales: 1,
      saleItems: 1,
      payments: 1,
      receipts: 1,
      refunds: 1,
      refundItems: 1,
      refundPayments: 1,
      checkoutRequests: 1,
      refundRequests: 1,
      productMovements: 4,
    },
    replayVerificationObservedDeltas: expectedDeltas,
    inventoryCounts: {
      stockInIdentitySha256: sha256(stockInCountId),
      stockOutIdentitySha256: sha256(stockOutCountId),
      postReplayWasNoOp: true,
      activationBaselineRestored: true,
    },
    stockPolicy: stockValidation.policy,
    inventoryNetQuantityDelta: Number(after.quantity) - Number(before.quantity),
    unexplainedBusinessDelta: 0,
    blindOldSourceFailbackSafe: false,
    rawPiiPersisted: false,
  };
  await writeR8Evidence("controlled-production-write.json", evidence);
  console.log(JSON.stringify({
    status: evidence.status,
    firstBusinessAuthoritativeTargetWrite: evidence.firstBusinessAuthoritativeTargetWrite,
    checkoutReplay: "PASS",
    refundReplay: "PASS",
    inventoryRestored: "PASS",
    unexplainedBusinessDelta: 0,
  }, null, 2));
  console.log("TINDIO R8 CONTROLLED PRODUCTION WRITE CERTIFICATION: PASS");
} finally {
  await supabase.auth.signOut().catch(() => null);
}
