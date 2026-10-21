import { z } from "zod";

import {
  checkoutSaleSchema,
  checkoutSubmissionSchema,
  type CheckoutSaleActionResult,
  type CheckoutSaleValues,
  type CheckoutSequenceInfo,
  type CheckoutSubmission,
} from "@tindio/contracts/checkout";

export const POS_OFFLINE_CHECKOUT_PATH = "/api/pos/v2/offline-checkout" as const;
export const POS_OFFLINE_CHECKOUT_DEVICE_RPC = "validate_pos_device" as const;
export const POS_OFFLINE_CHECKOUT_RESERVE_RPC = "reserve_pos_device_sequence" as const;
export const POS_OFFLINE_CHECKOUT_FINALIZE_RPC = "finalize_pos_device_sequence" as const;
export const POS_OFFLINE_CHECKOUT_RECORD_RPC = "record_offline_sync_event" as const;

export const POS_OFFLINE_CHECKOUT_INVALID_MESSAGE =
  "The queued sale data is invalid." as const;
export const POS_OFFLINE_CHECKOUT_UNCONFIRMED_MESSAGE =
  "TINDIO could not confirm this queued sale. It will remain queued for review." as const;
export const POS_OFFLINE_CHECKOUT_RESERVATION_MESSAGE =
  "TINDIO could not reserve this device sequence. The saved sale will remain queued." as const;
export const POS_OFFLINE_CHECKOUT_FINALIZATION_MESSAGE =
  "TINDIO accepted the sale but could not finalize its sequence checkpoint. Retry this same saved sale." as const;
export const POS_OFFLINE_CHECKOUT_SEQUENCE_MESSAGE =
  "This saved sale cannot be applied until its device sequence is reconciled." as const;
export const POS_OFFLINE_CHECKOUT_DEVICE_IDENTITY_MESSAGE =
  "The saved sale device identity is invalid." as const;
export const POS_OFFLINE_CHECKOUT_DEVICE_REVOKED_MESSAGE =
  "This POS device is not active for the saved sale terminal." as const;
export const POS_OFFLINE_CHECKOUT_TOTAL_MESSAGE =
  "The queued sale is missing its original total and needs review." as const;
export const POS_OFFLINE_CHECKOUT_NOTE_MESSAGE =
  "This queued sale note is too long to sync safely and needs review." as const;
export const POS_OFFLINE_CHECKOUT_PAYMENT_MESSAGE =
  "Offline settlement requires one cached cash payment." as const;
export const POS_OFFLINE_CHECKOUT_PAYMENT_METHOD_MESSAGE =
  "This payment method no longer permits automatic offline cash settlement." as const;

export const POS_OFFLINE_CHECKOUT_SEQUENCE_STATUSES = [
  "ACCEPTED",
  "REPLAY",
  "GAP",
  "DUPLICATE_SEQUENCE",
  "OUT_OF_ORDER",
  "IDEMPOTENCY_SEQUENCE_MISMATCH",
] as const satisfies readonly CheckoutSequenceInfo["status"][];

export const POS_OFFLINE_CHECKOUT_TERMINAL_CONFLICTS = [
  "DUPLICATE_TRANSACTION",
  "INVALID_SHIFT",
  "CLOSED_SHIFT",
  "PRODUCT_ARCHIVED",
  "PRICE_CHANGED",
  "TAX_CHANGED",
  "CUSTOMER_INVALID",
  "INVENTORY_CONFLICT",
  "PERMISSION_CHANGED",
  "REGISTER_REVOKED",
  "DEVICE_REVOKED",
] as const;

export const offlineCheckoutRequestSchema = z.union([
  checkoutSubmissionSchema,
  checkoutSaleSchema,
]);

export type OfflineCheckoutRequest = CheckoutSubmission | CheckoutSaleValues;
export type OfflineCheckoutResult = CheckoutSaleActionResult;
