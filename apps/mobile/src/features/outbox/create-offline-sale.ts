import * as Crypto from "expo-crypto";
import type { PosCartLine, PosDeviceBinding } from "../../../../../src/contracts/pos";
import { enqueueSaleCompletedEvent } from "../../db/outbox";
import { getBusinessContextSnapshot } from "../../db/business-context-cache";
import { getActiveShiftSnapshot } from "../../db/shift-cache";
import { getLocalPaymentMethods } from "../local-first/local-reference";
import { validateOfflineAuthorizationGrant } from "../offline/offline-authorization";
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
  | { ok: false; reason: string };

const money = (minor: number) => (minor / 100).toFixed(2);

function validCartLine(line: PosCartLine) {
  return Number.isFinite(line.quantity) && line.quantity > 0 &&
    (line.allowFractionalQuantity || Number.isInteger(line.quantity)) &&
    !line.isVariablePrice && line.manualPriceMinor === null &&
    (line.modifierOptionIds?.length ?? 0) === 0 && (line.modifiers?.length ?? 0) === 0;
}

export async function createOfflineCashSale(input: OfflineSaleAcceptanceInput): Promise<OfflineSaleAcceptanceResult> {
  const authorization = await validateOfflineAuthorizationGrant();
  if (!authorization.ok) return { ok: false, reason: `OFFLINE_AUTHORIZATION_${authorization.reason}` };
  const grant = authorization.grant;
  if (grant.organizationId !== input.organizationId || grant.deviceId !== input.deviceId ||
      grant.storeId !== input.binding.storeId || grant.registerId !== input.binding.registerId) {
    return { ok: false, reason: "OFFLINE_CONTEXT_MISMATCH" };
  }

  const [context, shiftSnapshot, paymentMethods] = await Promise.all([
    getBusinessContextSnapshot(input.organizationId),
    getActiveShiftSnapshot(input.organizationId, input.binding.storeId, input.binding.registerId),
    getLocalPaymentMethods(input.organizationId, input.binding.storeId),
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
  const snapshot: DurableSaleSnapshot = {
    version: 1, capturedAt: createdAt, organizationId: input.organizationId,
    storeId: input.binding.storeId, registerId: input.binding.registerId, shiftId: grant.shiftId,
    deviceId: input.deviceId, employeeId: context.core.employee.id, employeeName: context.core.employee.name,
    currencyCode: context.core.organization.currencyCode, localReceiptReference: localReference,
    subtotalMinor: input.totals.subtotalMinor, discountMinor: input.totals.discountMinor,
    taxMinor: input.totals.taxMinor, totalMinor: input.totals.totalMinor,
    tenderedMinor: input.tenderedMinor, changeMinor, itemCount: input.cart.reduce((count, line) => count + line.quantity, 0),
  };
  const event = await enqueueSaleCompletedEvent({
    eventId, organizationId: input.organizationId, storeId: input.binding.storeId,
    registerId: input.binding.registerId, deviceId: input.deviceId, shiftId: grant.shiftId,
    idempotencyKey, localReference, payload, snapshot, createdAt,
  });
  return event ? { ok: true, event } : { ok: false, reason: "DURABLE_ENQUEUE_FAILED" };
}
