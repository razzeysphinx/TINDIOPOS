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
