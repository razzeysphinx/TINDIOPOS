import type { CustomerDisplayState } from "@tindio/contracts/customer-display";

export {
  customerDisplayStateSchema,
  customerDisplayUpdateSchema,
} from "@tindio/contracts/customer-display";
export type {
  CustomerDisplayState,
  CustomerDisplayUpdate,
  PosCustomerDisplaySession,
} from "@tindio/contracts/customer-display";

export type CustomerDisplayBootstrap = {
  businessName: string;
  storeName: string;
  registerName: string;
  realtimeTopic: string;
  initialState: CustomerDisplayState;
};

export type CustomerDisplayActionResult =
  | { ok: true; message: string; displayUrl: string }
  | { ok: false; message: string };

export function createIdleCustomerDisplayState(updatedAt = new Date().toISOString()): CustomerDisplayState {
  return {
    status: "idle",
    items: [],
    subtotalMinor: 0,
    discountMinor: 0,
    taxMinor: 0,
    totalMinor: 0,
    payments: [],
    customer: null,
    saleId: null,
    receiptNumber: null,
    changeMinor: 0,
    updatedAt,
  };
}
