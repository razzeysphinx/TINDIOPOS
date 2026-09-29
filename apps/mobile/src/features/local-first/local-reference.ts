import { getReferenceSnapshot } from "../../db/reference-cache";
import { incrementLocalFirstMetric } from "./runtime-metrics";

export async function getLocalReference(organizationId: string) {
  incrementLocalFirstMetric("sqliteReferenceReads");
  return getReferenceSnapshot(organizationId);
}

export async function getLocalCategories(organizationId: string) {
  return (await getLocalReference(organizationId))?.reference.categories ?? [];
}

export async function getLocalDiscounts(organizationId: string) {
  return (await getLocalReference(organizationId))?.reference.discounts ?? [];
}

export async function getLocalTaxRates(organizationId: string) {
  return (await getLocalReference(organizationId))?.reference.taxRates ?? [];
}

export async function getLocalDiningOptions(organizationId: string) {
  return (await getLocalReference(organizationId))?.reference.diningOptions ?? [];
}

export async function getLocalPaymentMethods(organizationId: string, storeId: string) {
  return ((await getLocalReference(organizationId))?.reference.paymentMethods ?? [])
    .filter((method) => method.storeId === storeId)
    .sort((left, right) => left.sortOrder - right.sortOrder);
}
