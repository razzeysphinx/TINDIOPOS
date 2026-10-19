/** Stable identifier for the supported TINDIO POS HTTP contract family. */
export const TINDIO_POS_API_VERSION = "v2" as const;

export type TindioPosApiVersion =
  typeof TINDIO_POS_API_VERSION;

export * from "./device";
export * from "./pos-data";
export * from "./sync-control";
