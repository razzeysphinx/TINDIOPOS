import { z } from "zod";

import { posDeviceValidationSchema } from "@tindio/contracts/device";
import type {
  PosCatalogItem,
  PosCustomer,
  PosReferenceV2Response,
} from "@tindio/contracts/pos-data";

export const POS_SYNC_BASELINE_PATH = "/api/pos/v2/sync/baseline" as const;
export const POS_SYNC_CHECKPOINT_PATH = "/api/pos/v2/sync/checkpoint" as const;
export const POS_SYNC_PULL_PATH = "/api/pos/v2/sync/pull" as const;
export const POS_SYNC_RESNAPSHOT_PATH = "/api/pos/v2/sync/resnapshot" as const;
export const POS_SYNC_TELEMETRY_PATH = "/api/pos/v2/sync/telemetry" as const;
export const POS_SYNC_VERSION = 1 as const;
export const POS_SYNC_PULL_DEFAULT_LIMIT = 100 as const;
export const POS_SYNC_PULL_MAX_LIMIT = 200 as const;

export const POS_SYNC_DEVICE_RPC = "validate_pos_device" as const;
export const POS_SYNC_REVISION_RPC = "get_pos_sync_revision" as const;
export const POS_SYNC_CHECKPOINT_RPC = "get_pos_device_sync_checkpoint" as const;
export const POS_SYNC_RETENTION_RPC = "get_pos_sync_retention_state" as const;
export const POS_SYNC_CHANGE_WINDOW_RPC = "get_pos_sync_change_window" as const;
export const POS_SYNC_CATALOG_RPC = "get_pos_catalog_product_v2" as const;
export const POS_SYNC_CUSTOMER_RPC = "get_pos_sync_customer" as const;
export const POS_SYNC_REFERENCE_RPC = "get_pos_reference_bundle_v2" as const;
export const POS_SYNC_RESNAPSHOT_RPC = "get_pos_sync_resnapshot_v1" as const;
export const POS_SYNC_TELEMETRY_RPC = "report_pos_device_sync_telemetry" as const;

export const POS_SYNC_BASELINE_INVALID_MESSAGE = "Invalid baseline request." as const;
export const POS_SYNC_CHECKPOINT_INVALID_MESSAGE = "The checkpoint request is invalid." as const;
export const POS_SYNC_PULL_INVALID_MESSAGE = "Invalid sync pull request." as const;
export const POS_SYNC_RESNAPSHOT_INVALID_MESSAGE = "Invalid sync resnapshot request." as const;
export const POS_SYNC_TELEMETRY_INVALID_MESSAGE = "The POS telemetry request is invalid." as const;
export const POS_SYNC_DEVICE_REJECTED_MESSAGE = "POS device validation failed." as const;
export const POS_SYNC_CHECKPOINT_DEVICE_REJECTED_MESSAGE = "This POS device is not active for your assigned store." as const;
export const POS_SYNC_BASELINE_UNAVAILABLE_MESSAGE = "TINDIO could not establish a sync baseline." as const;
export const POS_SYNC_CHECKPOINT_UNAVAILABLE_MESSAGE = "TINDIO could not read the device checkpoint." as const;
export const POS_SYNC_PULL_UNAVAILABLE_MESSAGE = "TINDIO could not pull cloud changes." as const;
export const POS_SYNC_RESNAPSHOT_UNAVAILABLE_MESSAGE = "TINDIO could not rebuild the local cache." as const;
export const POS_SYNC_TELEMETRY_UNAVAILABLE_MESSAGE = "TINDIO could not record sync telemetry." as const;

export const posSyncDeviceRequestSchema = posDeviceValidationSchema;
export const posSyncPullRequestSchema = posDeviceValidationSchema.extend({
  cursor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  limit: z.number().int().min(1).max(POS_SYNC_PULL_MAX_LIMIT).optional(),
});

export const posSyncConnectionModeSchema = z.enum([
  "CLOUD_ONLINE",
  "STORE_LOCAL",
  "DEVICE_ISOLATED",
  "RECOVERING",
  "SYNC_REVIEW",
]);
export const posSyncLocalDatabaseHealthSchema = z.enum([
  "HEALTHY",
  "CHECK_REQUIRED",
  "UNAVAILABLE",
  "UNKNOWN",
]);
export const posSyncTelemetryRequestSchema = posDeviceValidationSchema.extend({
  employeeId: z.uuid(),
  employeeName: z.string().trim().min(1).max(160),
  connectionMode: posSyncConnectionModeSchema,
  lastSuccessfulSyncAt: z.iso.datetime().nullable(),
  deviceCheckpoint: z.number().int().min(0),
  serverCheckpoint: z.number().int().min(0),
  queueDepth: z.number().int().min(0),
  conflictCount: z.number().int().min(0),
  failedCount: z.number().int().min(0),
  offlineSince: z.iso.datetime().nullable(),
  crashCount: z.number().int().min(0).default(0),
  crashWindowStartedAt: z.iso.datetime().nullable().default(null),
  lastCrashAt: z.iso.datetime().nullable().default(null),
  anrCount: z.number().int().min(0).default(0),
  lastAnrAt: z.iso.datetime().nullable().default(null),
  apiAverageLatencyMs: z.number().int().min(0).default(0),
  apiMaxLatencyMs: z.number().int().min(0).default(0),
  apiFailureCount: z.number().int().min(0).default(0),
  syncAverageLatencyMs: z.number().int().min(0).default(0),
  syncMaxLatencyMs: z.number().int().min(0).default(0),
  localDatabaseHealth: posSyncLocalDatabaseHealthSchema.default("UNKNOWN"),
  localSchemaVersion: z.number().int().min(0).default(0),
});

export type PosSyncDeviceRequest = z.infer<typeof posSyncDeviceRequestSchema>;
export type PosSyncPullRequest = z.infer<typeof posSyncPullRequestSchema>;
export type PosSyncTelemetryRequest = z.infer<typeof posSyncTelemetryRequestSchema>;

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

export type PosSyncCheckpointResponse = {
  ok: true;
  checkpoint: {
    deviceId: string;
    serverCheckpoint: number;
    nextExpectedSequence: number;
    updatedAt: string | null;
  };
};

export type PosSyncTelemetryResponse = {
  ok: true;
  deviceId: string;
  heartbeatAt: string;
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
