export const RECEIVABLE_TRANSFER_QUERY_STATUSES = [
  "dispatched",
  "partially_received",
] as const;

export type ReceivableTransferStatus =
  (typeof RECEIVABLE_TRANSFER_QUERY_STATUSES)[number];

export function isReceivableTransferState(
  status: string,
  stockRequestId: string | null,
): status is ReceivableTransferStatus {
  void stockRequestId;
  return status === "dispatched"
    || status === "partially_received";
}
