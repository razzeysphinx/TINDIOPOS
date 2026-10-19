import { z } from "zod";

import type {
  BusinessType,
} from "@/features/business-profile/business-features";
import type {
  PosActiveShift,
  PosOpenTicket,
  PosRegister,
  PosStore,
  PosTicketAssignee,
  TimeClockEntry,
} from "@tindio/contracts";
import type {
  CheckoutSaleActionResult,
  ValidateCartStockActionResult,
} from "@/features/checkout/checkout-types";
import type { CheckoutSaleValues } from "@/features/checkout/checkout-schema";
import type {
  PosCustomerDisplaySession,
} from "@/features/customer-display/customer-display-types";
import type {
  PosCatalogItem,
  PosCategory,
  PosDiningOption,
  PosDiscount,
  PosIncomingTransfer,
  PosLoyaltyProgram,
  PosPaymentMethod,
  PosTaxRate,
  PosTicketTemplate,
} from "@/features/pos/pos-types";
export {
  TINDIO_POS_API_VERSION,
} from "@tindio/contracts";

export type {
  AttendanceEmployee,
  AttendanceEmployeesResult,
  PosActiveShift,
  PosClientUpgradeRequiredResponse,
  PosCloseShiftV2Response,
  PosOpenShiftV2Response,
  PosOpenTicket,
  PosReceiptDetail,
  PosReceiptListResponse,
  PosReceiptSummary,
  PosRegister,
  PosStore,
  PosTicketAssignee,
  TimeClockEntry,
} from "@tindio/contracts";

export const posUuidSchema =
  z.uuid();

export const posCatalogV2QuerySchema =
  z.object({
    store: z.uuid(),
    mode:
      z.enum([
        "search",
        "favorites",
        "recent",
      ])
        .optional()
        .default("search"),
    query:
      z.string()
        .trim()
        .max(100)
        .optional()
        .default(""),
    category:
      z.uuid().optional(),
    offset:
      z.coerce
        .number()
        .int()
        .min(0)
        .max(10_000)
        .optional()
        .default(0),
    limit:
      z.coerce
        .number()
        .int()
        .min(1)
        .max(24)
        .optional()
        .default(24),
  });

export const posCustomerSearchQuerySchema =
  z.object({
    q:
      z.string()
        .trim()
        .max(100)
        .optional(),
    store: z.uuid(),
  });

export const posModifierQuerySchema =
  z.object({
    product: z.uuid(),
    store: z.uuid(),
  });

export const posReceiptSearchQuerySchema =
  z.object({
    q:
      z.string()
        .trim()
        .max(100)
        .optional()
        .default(""),
    before:
      z.coerce
        .number()
        .int()
        .positive()
        .max(
          Number.MAX_SAFE_INTEGER,
        )
        .optional(),
  });

export type PosCatalogV2Query =
  z.infer<
    typeof posCatalogV2QuerySchema
  >;

export type PosCustomerSearchQuery =
  z.infer<
    typeof posCustomerSearchQuerySchema
  >;

export type PosModifierQuery =
  z.infer<
    typeof posModifierQuerySchema
  >;

export type PosReceiptSearchQuery =
  z.infer<
    typeof posReceiptSearchQuerySchema
  >;

export type PosSupportWorkspace = {
  stores: PosStore[];
  categories: PosCategory[];
  registers: PosRegister[];
  paymentMethods:
    PosPaymentMethod[];
  loyaltyProgram:
    PosLoyaltyProgram | null;
  discounts: PosDiscount[];
  taxRates: PosTaxRate[];
  diningOptions:
    PosDiningOption[];
  ticketTemplates:
    PosTicketTemplate[];
  customerDisplaySessions:
    PosCustomerDisplaySession[];
  timeClockEntry:
    TimeClockEntry | null;
  activeShift:
    PosActiveShift | null;
  initialItems:
    PosCatalogItem[];
  initialFavoriteItems:
    PosCatalogItem[];
  initialRecentItems:
    PosCatalogItem[];
  openTickets:
    PosOpenTicket[];
  ticketAssignees:
    PosTicketAssignee[];
  canReceiveIncomingTransfers:
    boolean;
  incomingTransfers:
    PosIncomingTransfer[];
};

export type PosBootstrapV2CoreResponse = {
  ok: true;
  version: 2;
  requestId: string;

  core: {
    profileId: string;

    organization: {
      id: string;
      name: string;
      currencyCode: string;
      timezone: string;
      status:
        | "active"
        | "suspended"
        | "archived";
      businessType:
        BusinessType;
      deviceManagementEnabled:
        boolean;
    };

    employee: {
      id: string;
      employeeNumber: string;
      jobTitle: string | null;
      name: string;
    };

    availableOrganizations:
      Array<{
        id: string;
        name: string;
        status:
          | "active"
          | "suspended"
          | "archived";
      }>;

    roleNames: string[];
    permissions: string[];
    storeIds: string[];
    stores: PosStore[];
    registers: PosRegister[];
    features:
      Record<string, boolean>;

    activeShift:
      PosActiveShift | null;
  };
};

export type PosLiveV2Response = {
  ok: true;
  version: 2;
  requestId: string;
  organizationId: string;
  storeId: string | null;
  registerId: string | null;
  live: {
    timeClockEntry:
      TimeClockEntry | null;
    customerDisplaySessions:
      PosCustomerDisplaySession[];
    canReceiveIncomingTransfers:
      boolean;
    incomingTransfers:
      PosIncomingTransfer[];
    openTickets: PosOpenTicket[];
    ticketAssignees:
      PosTicketAssignee[];
  };
};

export type PosSyncPushEvent = { eventId: string; operationType: "SALE_COMPLETED"; checkout: CheckoutSaleValues; offline: { localReceiptReference: string; createdAt: string; shiftId: string; deviceId: string; deviceSequence: number } };
export type PosSyncPushAck = { eventId: string; deviceSequence: number; status: "SYNCED" | "RETRY" | "CONFLICT" | "FAILED"; httpStatus: number; result: CheckoutSaleActionResult };
export type PosSyncPushResponse = { ok: true; version: 1; organizationId: string; deviceId: string; acks: PosSyncPushAck[]; stoppedEarly: boolean };

export type PosCheckoutResponse =
  CheckoutSaleActionResult;

export type PosStockValidationResponse =
  ValidateCartStockActionResult;

export {
  checkoutSaleSchema,
  checkoutSubmissionSchema,
  offlineCheckoutMetadataSchema,
  validateCartStockSchema,
} from "@/features/checkout/checkout-schema";

export type {
  CheckoutSaleValues,
  CheckoutSubmission,
  ValidateCartStockValues,
} from "@/features/checkout/checkout-schema";

export type {
  ValidateCartStockActionResult,
} from "@/features/checkout/checkout-types";

export {
  changePosDeviceRegisterSchema,
  posDeviceCredentialSchema,
  posDeviceRequestHeaders,
  posDeviceValidationSchema,
  registerPosDeviceSchema,
  retirePosDeviceSchema,
} from "@tindio/contracts";

export type {
  PosCartLine,
  PosCatalogDelta,
  PosCatalogItem,
  PosCatalogResponse,
  PosCatalogV2Response,
  PosCategory,
  PosCustomer,
  PosCustomerDelta,
  PosCustomerSearchResponse,
  PosDeviceBinding,
  PosDeviceCredential,
  PosDeviceDelta,
  PosDeviceSequenceStatus,
  PosDeviceSyncCheckpoint,
  PosDeviceValidationResponse,
  PosModifierGroup,
  PosModifierOption,
  PosModifierResponse,
  PosModifiersV2Response,
  PosOfflineSequenceInfo,
  PosReferenceV2Response,
  PosSyncBaselineResponse,
  PosSyncCursorExpiredResponse,
  PosSyncDomain,
  PosSyncPullResponse,
  PosSyncResnapshotResponse,
} from "@tindio/contracts";

export {
  favoriteTileSchema,
} from "@/features/pos/pos-schema";

export {
  createCustomerSchema,
} from "@/features/customers/customer-schema";

export type {
  CreateCustomerValues,
} from "@/features/customers/customer-schema";

export {
  cashMovementSchema,
  closeShiftSchema,
  openShiftSubmissionSchema,
} from "@/features/shifts/shift-schema";

export {
  attendanceStoreSchema,
  clockInSchema,
  clockOutSchema,
} from "@/features/time-clock/time-clock-schema";

export type {
  TimeClockActionResult,
} from "@/features/time-clock/time-clock-types";

export {
  approveManagerApprovalSchema,
  requestManagerApprovalSchema,
} from "@/features/approvals/approval-schema";

export type {
  ApprovalActionResult,
  ApprovalPreparationResult,
  ApprovalStatusResult,
} from "@/features/approvals/approval-types";

export {
  refundSaleSchema,
} from "@/features/receipts/refund-schema";

export type {
  RefundSaleValues,
} from "@/features/receipts/refund-schema";

export {
  receiptDeliverySchema,
} from "@/features/receipts/improvement-6-schema";

export {
  cancelOpenTicketSchema,
  mergeOpenTicketsSchema,
  moveOpenTicketLinesSchema,
  saveOpenTicketSchema,
  splitOpenTicketSchema,
} from "@/features/advanced-sales/ticket-schema";

export type {
  TicketActionResult,
  TicketMutationResult,
} from "@/features/advanced-sales/ticket-schema";

export type {
  PosDiningOption,
  PosDiscount,
  PosIncomingTransfer,
  PosLoyaltyProgram,
  PosPaymentMethod,
  PosTaxRate,
  PosTicketTemplate,
} from "@/features/pos/pos-types";
