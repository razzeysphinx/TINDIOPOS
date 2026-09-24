import { z } from "zod";

import type {
  BusinessType,
} from "@/features/business-profile/business-features";
import type {
  CheckoutSaleActionResult,
  ValidateCartStockActionResult,
} from "@/features/checkout/checkout-types";
import type {
  PosCustomerDisplaySession,
} from "@/features/customer-display/customer-display-types";
import type {
  PosCapabilities,
} from "@/features/pos/pos-capabilities";
import type {
  PosActiveShift,
  PosCatalogItem,
  PosCategory,
  PosCustomer,
  PosDiningOption,
  PosDiscount,
  PosIncomingTransfer,
  PosLoyaltyProgram,
  PosOpenTicket,
  PosPaymentMethod,
  PosRegister,
  PosStore,
  PosTaxRate,
  PosTicketAssignee,
  PosTicketTemplate,
} from "@/features/pos/pos-types";
import type {
  TimeClockEntry,
} from "@/features/time-clock/time-clock-types";
import type {
  Json,
} from "@/lib/supabase/database.types";

export const TINDIO_POS_API_VERSION =
  "v1" as const;

export const posUuidSchema =
  z.uuid();

export const posCatalogQuerySchema =
  z.object({
    store: z.uuid(),
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

export type PosCatalogQuery =
  z.infer<
    typeof posCatalogQuerySchema
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

export type PosWorkspaceContract = {
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

export type PosReceiptSummary = {
  receipt_id: string;
  sale_id: string;
  receipt_number: number;
  issued_at: string;
  store_id: string;
  register_id: string;
  store_name: string;
  register_name: string;
  cashier_name: string;
  total_minor: number;
  currency_code: string;
  refund_total_minor: number;
  refund_count: number;
  has_refundable_quantity:
    boolean;
  payment_methods:
    Array<{
      name: string;
      type:
        | "CASH"
        | "CARD"
        | "E_WALLET"
        | "BANK_TRANSFER"
        | "VOUCHER"
        | "OTHER";
    }>;
};

export type PosReceiptDetail = {
  receipt: {
    id: string;
    number: number;
    issuedAt: string;
    layout: Json | null;
  };
  customerEmail:
    string | null;
  sale: {
    id: string;
    storeId: string;
    registerId: string;
    currencyCode: string;
    organizationName: string;
    storeName: string;
    registerName: string;
    cashierName: string;
    subtotalMinor: number;
    discountMinor: number;
    taxMinor: number;
    totalMinor: number;
  };
  items:
    Array<{
      id: string;
      name: string;
      sku: string | null;
      quantity: number;
      unit: string;
      unitPriceMinor: number;
      lineTotalMinor: number;
    }>;
  payments:
    Array<{
      id: string;
      name: string;
      type:
        | "CASH"
        | "CARD"
        | "E_WALLET"
        | "BANK_TRANSFER"
        | "VOUCHER"
        | "OTHER";
      amountMinor: number;
      tenderedMinor:
        number | null;
      changeMinor:
        number | null;
      referenceNumber:
        string | null;
    }>;
  refunds:
    Array<{
      id: string;
      number: number;
      totalMinor: number;
      completedAt: string;
      reason: string;
      paymentName:
        string | null;
      paymentReference:
        string | null;
      items:
        Array<{
          id: string;
          saleItemId: string;
          name: string;
          quantity: number;
          unit: string;
          lineTotalMinor:
            number;
        }>;
    }>;
};

export type PosBootstrapResponse = {
  organization: {
    id: string;
    name: string;
    currencyCode: string;
    timezone: string;
    businessType:
      BusinessType;
    deviceManagementEnabled:
      boolean;
  };
  employee: {
    id: string;
    employeeNumber: string;
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
  capabilities:
    PosCapabilities;
  offlineScope: string;
  workspace:
    PosWorkspaceContract;
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

export type PosReferenceV2Response = {
  ok: true;
  version: 2;
  requestId: string;
  organizationId: string;
  referenceVersion: string;
  reference: {
    categories: PosCategory[];
    paymentMethods: PosPaymentMethod[];
    loyaltyProgram:
      PosLoyaltyProgram | null;
    discounts: PosDiscount[];
    taxRates: PosTaxRate[];
    diningOptions:
      PosDiningOption[];
    ticketTemplates:
      PosTicketTemplate[];
  };
};

export type PosCatalogResponse = {
  items:
    PosCatalogItem[];
  hasMore: boolean;
};

export type PosCustomerSearchResponse = {
  customers:
    PosCustomer[];
};

export type PosModifierOption = {
  id: string;
  name: string;
  priceMinor: number;
};

export type PosModifierGroup = {
  id: string;
  name: string;
  minSelections: number;
  maxSelections: number;
  options:
    PosModifierOption[];
};

export type PosModifierResponse = {
  groups:
    PosModifierGroup[];
};

export type PosReceiptListResponse = {
  receipts:
    PosReceiptSummary[];
  hasMore: boolean;
};

export type PosDeviceBinding = {
  deviceId: string;
  storeId: string;
  registerId: string;
  deviceName: string;
  appVersion: string;
  lastSeenAt: string;
};

export type PosDeviceValidationResponse =
  | {
      ok: true;
      device:
        PosDeviceBinding;
    }
  | {
      ok: false;
      message: string;
    };

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

export {
  posDeviceCredentialSchema,
  posDeviceValidationSchema,
  registerPosDeviceSchema,
} from "@/features/devices/device-schema";

export type {
  PosDeviceCredential,
} from "@/features/devices/device-schema";

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
  AttendanceEmployee,
  AttendanceEmployeesResult,
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
  PosActiveShift,
  PosCatalogItem,
  PosCategory,
  PosCustomer,
  PosDiningOption,
  PosDiscount,
  PosIncomingTransfer,
  PosLoyaltyProgram,
  PosOpenTicket,
  PosPaymentMethod,
  PosRegister,
  PosStore,
  PosTaxRate,
  PosTicketAssignee,
  PosTicketTemplate,
} from "@/features/pos/pos-types";
