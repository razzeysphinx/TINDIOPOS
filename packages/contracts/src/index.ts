/** Stable identifier for the supported TINDIO POS HTTP contract family. */
export const TINDIO_POS_API_VERSION = "v2" as const;

export type TindioPosApiVersion =
  typeof TINDIO_POS_API_VERSION;

export * from "./business";
export * from "./auth";
export * from "./auth-client-compatibility";
export * from "./checkout";
export * from "./device";
export * from "./attendance";
export * from "./approval-control";
export * from "./attendance-mutation";
export * from "./cart";
export * from "./customer-display";
export * from "./customer-creation";
export * from "./favorite-tile";
export * from "./open-ticket-save";
export * from "./open-ticket-cancel";
export * from "./open-ticket-move-lines";
export * from "./open-ticket-split";
export * from "./open-ticket-merge";
export * from "./pos-data";
export * from "./pos-operations";
export * from "./pos-runtime";
export * from "./receipts";
export * from "./receipt-settings";
export * from "./receipt-delivery";
export * from "./sale-exchange";
export * from "./shift-control";
export * from "./stock-request-receipt";
export * from "./sync-control";
export * from "./sync-push";
export * from "./transfer-receipt";
export * from "./transfers";
export * from "./ui";
