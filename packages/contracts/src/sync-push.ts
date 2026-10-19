import type {
  CheckoutSaleActionResult,
  CheckoutSaleValues,
} from "./checkout";

export type PosSyncPushEvent = {
  eventId: string;
  operationType: "SALE_COMPLETED";
  checkout: CheckoutSaleValues;
  offline: {
    localReceiptReference: string;
    createdAt: string;
    shiftId: string;
    deviceId: string;
    deviceSequence: number;
  };
};

export type PosSyncPushAck = {
  eventId: string;
  deviceSequence: number;
  status: "SYNCED" | "RETRY" | "CONFLICT" | "FAILED";
  httpStatus: number;
  result: CheckoutSaleActionResult;
};

export type PosSyncPushResponse = {
  ok: true;
  version: 1;
  organizationId: string;
  deviceId: string;
  acks: PosSyncPushAck[];
  stoppedEarly: boolean;
};
