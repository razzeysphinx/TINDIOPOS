import type { CheckoutSaleValues } from "../../../../../src/features/checkout/checkout-schema";

export type OutboxOperationType = "SALE_COMPLETED";
export type OutboxState = "LOCAL_PENDING" | "SYNCING" | "SYNCED" | "CONFLICT" | "FAILED";

export type DurableSaleSnapshot = {
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
