import "server-only";

type ReadError = { message: string };

export type PosBootstrapNeed =
  | "stores"
  | "categories"
  | "registers"
  | "paymentMethods"
  | "storePaymentMethods"
  | "openShifts"
  | "loyaltyPrograms"
  | "discounts"
  | "taxRates"
  | "diningOptions"
  | "ticketTemplates";

export type PosBootstrapBundle = Record<PosBootstrapNeed, Array<Record<string, unknown>>>;

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function rows(record: Record<string, unknown>, key: PosBootstrapNeed): Array<Record<string, unknown>> {
  return Array.isArray(record[key]) ? record[key] as Array<Record<string, unknown>> : [];
}

export async function loadPosBootstrapBundleResult(input: {
  client: { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: ReadError | null }> };
  organizationId: string;
  storeIds: string[];
  employeeId: string;
}): Promise<{ data: PosBootstrapBundle; error: ReadError | null }> {
  const result = await input.client.rpc("get_pos_bootstrap_bundle_v1", {
    target_organization_id: input.organizationId,
    target_store_ids: input.storeIds,
    target_employee_id: input.employeeId,
  });
  const record = recordOf(result.data);
  return {
    data: {
      stores: rows(record, "stores"), categories: rows(record, "categories"), registers: rows(record, "registers"), paymentMethods: rows(record, "paymentMethods"), storePaymentMethods: rows(record, "storePaymentMethods"), openShifts: rows(record, "openShifts"), loyaltyPrograms: rows(record, "loyaltyPrograms"), discounts: rows(record, "discounts"), taxRates: rows(record, "taxRates"), diningOptions: rows(record, "diningOptions"), ticketTemplates: rows(record, "ticketTemplates"),
    },
    error: result.error,
  };
}
