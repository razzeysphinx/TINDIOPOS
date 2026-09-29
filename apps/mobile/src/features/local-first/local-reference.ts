import type {
  PosCategory,
  PosDiningOption,
  PosDiscount,
  PosPaymentMethod,
  PosTaxRate,
} from "../../../../../src/contracts/pos";
import {
  getReferenceSnapshot,
  type LocalReferenceSnapshot,
} from "../../db/reference-cache";
import {
  incrementLocalFirstMetric,
} from "./runtime-metrics";

export async function getLocalReference(
  organizationId: string,
): Promise<LocalReferenceSnapshot | null> {
  incrementLocalFirstMetric(
    "sqliteReferenceReads",
  );

  return getReferenceSnapshot(
    organizationId,
  );
}

export async function getLocalCategories(
  organizationId: string,
): Promise<PosCategory[]> {
  return (
    await getLocalReference(
      organizationId,
    )
  )?.reference.categories ?? [];
}

export async function getLocalDiscounts(
  organizationId: string,
): Promise<PosDiscount[]> {
  return (
    await getLocalReference(
      organizationId,
    )
  )?.reference.discounts ?? [];
}

export async function getLocalTaxRates(
  organizationId: string,
): Promise<PosTaxRate[]> {
  return (
    await getLocalReference(
      organizationId,
    )
  )?.reference.taxRates ?? [];
}

export async function getLocalDiningOptions(
  organizationId: string,
): Promise<PosDiningOption[]> {
  return (
    await getLocalReference(
      organizationId,
    )
  )?.reference.diningOptions ?? [];
}

export async function getLocalPaymentMethods(
  organizationId: string,
  storeId: string,
): Promise<PosPaymentMethod[]> {
  return (
    (
      await getLocalReference(
        organizationId,
      )
    )?.reference.paymentMethods
    ?? []
  )
    .filter(
      (method) =>
        method.storeId
        === storeId,
    )
    .sort(
      (left, right) =>
        left.sortOrder
        - right.sortOrder,
    );
}