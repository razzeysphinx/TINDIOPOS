/** Stable identifier for the supported TINDIO POS HTTP contract family. */
export const TINDIO_POS_API_VERSION = "v2" as const;

export type TindioPosApiVersion =
  typeof TINDIO_POS_API_VERSION;

export * from "./business";
export * from "./device";
export * from "./attendance";
export * from "./cart";
export * from "./customer-display";
export * from "./pos-data";
export * from "./pos-operations";
export * from "./pos-runtime";
export * from "./receipts";
export * from "./sync-control";
export * from "./transfers";
