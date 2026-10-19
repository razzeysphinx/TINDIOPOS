import type {
  PosCatalogItem,
  PosCustomer,
  PosReferenceV2Response,
} from "./pos-data";

/** Domains that can advance the POS delta-sync revision. */
export type PosSyncDomain =
  | "CATALOG"
  | "REFERENCE"
  | "CUSTOMER"
  | "DEVICE"
  | "MODIFIERS";

/** Device registry change carried by a delta-sync page. */
export type PosDeviceDelta = {
  revision: number;
  deviceId: string;
  status: string;
  storeId: string;
  registerId: string;
  deviceName: string;
  appVersion: string;
  lastSeenAt: string | null;
};

/** Initial server revision and scope returned before delta synchronization. */
export type PosSyncBaselineResponse = {
  ok: true;
  serverRevision: number;
  organizationId: string;
  deviceId: string;
  storeId: string;
};

/** Fail-closed response requiring a controlled resnapshot after retention expiry. */
export type PosSyncCursorExpiredResponse = {
  ok: false;
  version: 1;
  code: "SYNC_CURSOR_EXPIRED";
  organizationId: string;
  deviceId: string;
  storeId: string;
  fromCursor: number;
  retainedAfterRevision: number;
  serverRevision: number;
};

export type PosCatalogDelta = {
  revision: number;
  productId: string;
  storeId: string;
  items: PosCatalogItem[];
};

export type PosCustomerDelta = {
  revision: number;
  customerId: string;
  customer: PosCustomer | null;
};

export type PosSyncPullResponse = {
  ok: true;
  version: 1;
  organizationId: string;
  deviceId: string;
  storeId: string;
  fromCursor: number;
  nextCursor: number;
  serverRevision: number;
  hasMore: boolean;
  catalog: PosCatalogDelta[];
  reference: { revision: number; snapshot: PosReferenceV2Response } | null;
  customers: PosCustomerDelta[];
  device: PosDeviceDelta | null;
  invalidateModifiers: boolean;
};

export type PosSyncResnapshotResponse = {
  ok: true;
  version: 1;
  organizationId: string;
  deviceId: string;
  storeId: string;
  serverRevision: number;
  retainedAfterRevision: number;
  catalog: PosCatalogItem[];
  reference: PosReferenceV2Response;
  clearObservedCustomers: true;
  invalidateModifiers: true;
};
