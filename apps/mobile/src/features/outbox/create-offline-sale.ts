import * as Crypto from "expo-crypto";
import type { PosCartLine, PosDeviceBinding } from "../../../../../src/contracts/pos";
import { enqueueSaleCompletedEvent } from "../../db/outbox";
import { getBusinessContextSnapshot } from "../../db/business-context-cache";
import { getActiveShiftSnapshot } from "../../db/shift-cache";
import { getLocalDiscounts, getLocalPaymentMethods, getLocalTaxRates } from "../local-first/local-reference";
import { calculateLocalCartTotals, localCartLineTotalMinor } from "../local-first/local-cart";
import { offlineAuthorizationFailureMessage, validateOfflineAuthorizationGrant } from "../offline/offline-authorization";
import type { LocalCartTotals } from "../local-first/local-cart";
import type { DurableOutboxEvent, DurableSaleSnapshot, SaleCompletedOutboxPayloadBeforeSequence } from "./outbox-types";

export type OfflineSaleAcceptanceInput = {
  organizationId: string;
  binding: PosDeviceBinding;
  deviceId: string;
  cart: PosCartLine[];
  totals: LocalCartTotals;
  discountId: string | null;
  taxRateId: string | null;
  tenderedMinor: number;
};

export type OfflineSaleAcceptanceResult =
  | { ok: true; event: DurableOutboxEvent }
  | { ok: false; reason: string; message?: string };

const money = (minor: number) => (minor / 100).toFixed(2);

function validCartLine(line: PosCartLine) {
  return Number.isFinite(line.quantity) && line.quantity > 0 &&
    (line.allowFractionalQuantity || Number.isInteger(line.quantity)) &&
    !line.isVariablePrice && line.manualPriceMinor === null &&
    (line.modifierOptionIds?.length ?? 0) === 0 && (line.modifiers?.length ?? 0) === 0 &&
    !(line.itemNote ?? "").trim();
}

export async function createOfflineCashSale(input: OfflineSaleAcceptanceInput): Promise<OfflineSaleAcceptanceResult> {
  const authorization = await validateOfflineAuthorizationGrant();
  if (!authorization.ok) return {
    ok: false,
    reason: `OFFLINE_AUTHORIZATION_${authorization.reason}`,
    message: offlineAuthorizationFailureMessage(authorization.reason),
  };
  const grant = authorization.grant;
  if (grant.organizationId !== input.organizationId || grant.deviceId !== input.deviceId ||
      grant.storeId !== input.binding.storeId || grant.registerId !== input.binding.registerId) {
    return { ok: false, reason: "OFFLINE_CONTEXT_MISMATCH" };
  }

  const [context, shiftSnapshot, paymentMethods, discounts, taxRates] = await Promise.all([
    getBusinessContextSnapshot(input.organizationId),
    getActiveShiftSnapshot(input.organizationId, input.binding.storeId, input.binding.registerId),
    getLocalPaymentMethods(input.organizationId, input.binding.storeId),
    getLocalDiscounts(input.organizationId),
    getLocalTaxRates(input.organizationId),
  ]);
  if (!context || context.core.organization.id !== input.organizationId || context.core.employee.id !== grant.employeeId) {
    return { ok: false, reason: "CACHED_BUSINESS_CONTEXT_REQUIRED" };
  }
  if (!shiftSnapshot || shiftSnapshot.shift.id !== grant.shiftId || shiftSnapshot.shift.storeId !== input.binding.storeId || shiftSnapshot.shift.registerId !== input.binding.registerId) {
    return { ok: false, reason: "ACTIVE_SHIFT_REQUIRED" };
  }
  if (input.cart.length === 0 || input.cart.length > 100 || !input.cart.every(validCartLine)) {
    return { ok: false, reason: "UNSUPPORTED_OFFLINE_CART" };
  }
  if (!Number.isInteger(input.totals.totalMinor) || input.totals.totalMinor <= 0 ||
      !Number.isInteger(input.tenderedMinor) || input.tenderedMinor < input.totals.totalMinor) {
    return { ok: false, reason: "VALID_CASH_TENDER_REQUIRED" };
  }
  const cashMethod = paymentMethods.find((method) =>
    method.type === "CASH" && method.offlinePolicy === "cash" && !method.requiresReference,
  );
  if (!cashMethod) return { ok: false, reason: "ELIGIBLE_CASH_PAYMENT_METHOD_REQUIRED" };
  const discount = input.discountId === null
    ? null
    : discounts.find((candidate) => candidate.id === input.discountId) ?? null;
  const tax = input.taxRateId === null
    ? null
    : taxRates.find((candidate) => candidate.id === input.taxRateId) ?? null;
  if (input.discountId !== null && !discount) return { ok: false, reason: "CACHED_DISCOUNT_REQUIRED" };
  if (input.taxRateId !== null && !tax) return { ok: false, reason: "CACHED_TAX_RATE_REQUIRED" };
  const verifiedTotals = calculateLocalCartTotals(input.cart, discount, tax);
  if (verifiedTotals.subtotalMinor !== input.totals.subtotalMinor
    || verifiedTotals.discountMinor !== input.totals.discountMinor
    || verifiedTotals.taxMinor !== input.totals.taxMinor
    || verifiedTotals.totalMinor !== input.totals.totalMinor) {
    return { ok: false, reason: "CACHED_TOTALS_MISMATCH" };
  }

  const createdAt = new Date().toISOString();
  const eventId = Crypto.randomUUID();
  const idempotencyKey = Crypto.randomUUID();
  const localReference = `OFF-${idempotencyKey.replaceAll("-", "").slice(0, 10).toUpperCase()}`;
  const changeMinor = input.tenderedMinor - input.totals.totalMinor;
  const checkout = {
    storeId: input.binding.storeId,
    registerId: input.binding.registerId,
    idempotencyKey,
    customerId: null,
    loyaltyRedemptionPoints: 0,
    discountId: input.discountId,
    taxRateId: input.taxRateId,
    diningOptionId: null,
    openTicketId: null,
    offlineExpectedTotalMinor: input.totals.totalMinor,
    items: input.cart.map((line) => ({
      productId: line.productId, variantId: line.variantId, quantity: line.quantity,
      unitPriceMinor: null, modifierOptionIds: [], itemNote: null,
    })),
    payments: [{
      paymentMethodId: cashMethod.id, tenderedAmount: money(input.tenderedMinor),
      referenceNumber: "", note: "",
    }],
  };
  const payload: SaleCompletedOutboxPayloadBeforeSequence = {
    checkout,
    offline: { localReceiptReference: localReference, createdAt, shiftId: grant.shiftId, deviceId: input.deviceId },
  };
  const store = context.core.stores.find((candidate) => candidate.id === input.binding.storeId);
  const register = context.core.registers.find((candidate) => candidate.id === input.binding.registerId);
  if (!store || !register || register.storeId !== store.id) {
    return { ok: false, reason: "CACHED_TERMINAL_CONTEXT_REQUIRED" };
  }
  const snapshot: DurableSaleSnapshot = {
    version: 2, capturedAt: createdAt, organizationId: input.organizationId,
    storeId: input.binding.storeId, registerId: input.binding.registerId, shiftId: grant.shiftId,
    deviceId: input.deviceId, employeeId: context.core.employee.id, employeeName: context.core.employee.name,
    organizationName: context.core.organization.name, storeName: store.name, registerName: register.name,
    currencyCode: context.core.organization.currencyCode, localReceiptReference: localReference,
    subtotalMinor: input.totals.subtotalMinor, discountMinor: input.totals.discountMinor,
    taxMinor: input.totals.taxMinor, totalMinor: input.totals.totalMinor,
    tenderedMinor: input.tenderedMinor, changeMinor, itemCount: input.cart.reduce((count, line) => count + line.quantity, 0),
    discount: discount ? { id: discount.id, name: discount.name } : null,
    tax: tax ? { id: tax.id, name: tax.name, rateBps: tax.rateBps, isInclusive: tax.isInclusive } : null,
    payment: { methodId: cashMethod.id, methodName: cashMethod.name, methodType: "CASH" },
    lines: input.cart.map((line, index) => ({
      lineNumber: index + 1,
      productId: line.productId,
      variantId: line.variantId,
      productName: line.productName,
      variantName: line.variantName,
      sku: line.sku,
      barcode: line.barcode,
      unit: line.unit,
      quantity: line.quantity,
      unitPriceMinor: line.priceMinor,
      modifierTotalMinor: 0,
      lineTotalMinor: localCartLineTotalMinor(line),
    })),
  };
  const event = await enqueueSaleCompletedEvent({
    eventId, organizationId: input.organizationId, storeId: input.binding.storeId,
    registerId: input.binding.registerId, deviceId: input.deviceId, shiftId: grant.shiftId,
    idempotencyKey, localReference, payload, snapshot, createdAt,
  });
  return event ? { ok: true, event } : { ok: false, reason: "DURABLE_ENQUEUE_FAILED" };
}
