import "server-only";

type ReadError = { message: string };

export type ReceiptDetailBundle = Record<string, Array<Record<string, unknown>>>;

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function rows(record: Record<string, unknown>, key: string): Array<Record<string, unknown>> {
  return Array.isArray(record[key]) ? record[key] as Array<Record<string, unknown>> : [];
}

export async function loadReceiptDetailBundle(input: {
  client: { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: ReadError | null }> };
  organizationId: string;
  receiptId: string;
  includeReprintExtensions: boolean;
  includeRefundMethods: boolean;
}): Promise<{ data: ReceiptDetailBundle; error: ReadError | null }> {
  const result = await input.client.rpc("get_receipt_detail_bundle_v1", {
    target_organization_id: input.organizationId,
    target_receipt_id: input.receiptId,
    include_reprint_extensions: input.includeReprintExtensions,
    include_refund_methods: input.includeRefundMethods,
  });
  const record = recordOf(result.data);
  return { data: Object.fromEntries(["receipts", "sales", "saleItems", "payments", "refunds", "refundItems", "refundPayments", "exchanges", "replacementReceipts", "deliveries", "customerEmails", "paymentMethods", "storePaymentMethods"].map((key) => [key, rows(record, key)])), error: result.error };
}
