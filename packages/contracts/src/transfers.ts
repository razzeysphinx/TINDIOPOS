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

/**
 * A read-only projection of a canonical transfer document for the receiving
 * POS. Stock changes only through the existing transfer receipt RPCs.
 */
export type PosIncomingTransfer = {
  id: string;
  transferNumber: number;
  stockRequestId: string | null;
  sourceStoreId: string;
  sourceStoreName: string;
  destinationStoreId: string;
  destinationStoreName: string;
  status: ReceivableTransferStatus;
  note: string | null;
  lines: Array<{
    id: string;
    label: string;
    unit: string;
    quantity: number;
    receivedQuantity: number;
    shortQuantity: number;
  }>;
};
