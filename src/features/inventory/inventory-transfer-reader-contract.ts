export const RECEIVABLE_TRANSFER_QUERY_STATUSES = [
  "dispatched",
  "in_transit",
  "partially_received",
] as const;

export type ReceivableTransferStatus =
  (typeof RECEIVABLE_TRANSFER_QUERY_STATUSES)[number];

export function isReceivableTransferState(
  status: string,
  stockRequestId: string | null,
): status is ReceivableTransferStatus {
  if (stockRequestId) {
    return status === "in_transit" || status === "partially_received";
  }

  return status === "dispatched"
    || status === "in_transit"
    || status === "partially_received";
}
