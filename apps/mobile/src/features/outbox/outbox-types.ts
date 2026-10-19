import type { CheckoutSaleValues } from "@tindio/contracts";

export type OutboxOperationType = "SALE_COMPLETED";
export type OutboxState = "LOCAL_PENDING" | "SYNCING" | "SYNCED" | "CONFLICT" | "FAILED";

export type DurableSaleSnapshotV1 = {
  version: 1;
  capturedAt: string;
  organizationId: string;
  storeId: string;
  registerId: string;
  shiftId: string;
  deviceId: string;
  employeeId: string;
  employeeName: string;
  currencyCode: string;
  localReceiptReference: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  tenderedMinor: number;
  changeMinor: number;
  itemCount: number;
};

export type DurableSaleSnapshotLine = {
  lineNumber: number;
  productId: string;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  sku: string | null;
  barcode: string | null;
  unit: string;
  quantity: number;
  unitPriceMinor: number;
  modifierTotalMinor: number;
  lineTotalMinor: number;
};

export type DurableSaleSnapshotV2 = Omit<DurableSaleSnapshotV1, "version"> & {
  version: 2;
  organizationName: string;
  storeName: string;
  registerName: string;
  discount: { id: string; name: string } | null;
  tax: { id: string; name: string; rateBps: number; isInclusive: boolean } | null;
  payment: { methodId: string; methodName: string; methodType: "CASH" };
  lines: DurableSaleSnapshotLine[];
};

export type DurableSaleSnapshot = DurableSaleSnapshotV1 | DurableSaleSnapshotV2;

export type SaleCompletedOutboxPayload = {
  checkout: CheckoutSaleValues;
  offline: {
    localReceiptReference: string;
    createdAt: string;
    shiftId: string;
    deviceId: string;
    deviceSequence: number;
  };
};

export type SaleCompletedOutboxPayloadBeforeSequence = Omit<SaleCompletedOutboxPayload, "offline"> & {
  offline: Omit<SaleCompletedOutboxPayload["offline"], "deviceSequence">;
};

export type DurableOutboxEvent = {
  eventId: string;
  organizationId: string;
  storeId: string;
  registerId: string;
  deviceId: string;
  deviceSequence: number;
  shiftId: string;
  operationType: OutboxOperationType;
  idempotencyKey: string;
  localReference: string;
  payload: SaleCompletedOutboxPayload;
  snapshot: DurableSaleSnapshot;
  state: OutboxState;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  syncedAt: string | null;
  lastError: string | null;
  conflictType: string | null;
  serverSaleId: string | null;
  officialReceiptNumber: number | null;
};

export type NewDurableOutboxEvent = Pick<
  DurableOutboxEvent,
  | "eventId"
  | "organizationId"
  | "storeId"
  | "registerId"
  | "deviceId"
  | "shiftId"
  | "idempotencyKey"
  | "localReference"
  | "snapshot"
  | "createdAt"
> & { payload: SaleCompletedOutboxPayloadBeforeSequence };

export type OutboxSummary = {
  pending: number;
  syncing: number;
  synced: number;
  conflict: number;
  failed: number;
  total: number;
};

export type SafeOutboxEventSummary = Pick<
  DurableOutboxEvent,
  "eventId" | "localReference" | "state" | "createdAt" | "lastError" | "conflictType" | "deviceSequence"
> & Pick<DurableSaleSnapshot, "currencyCode" | "totalMinor" | "itemCount">;

export type OutboxRecoveryItem = {
  eventId: string;
  organizationId: string;
  storeId: string;
  registerId: string;
  deviceId: string;
  deviceSequence: number | null;
  employeeId: string | null;
  localReference: string;
  state: OutboxState;
  createdAt: string;
  lastError: string | null;
  conflictType: string | null;
  currencyCode: string | null;
  totalMinor: number | null;
  itemCount: number | null;
  corrupt: boolean;
};
