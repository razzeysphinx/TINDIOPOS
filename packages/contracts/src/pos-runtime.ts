import type { TimeClockEntry } from "./attendance.js";
import type { BusinessType } from "./business.js";
import type { PosCustomerDisplaySession } from "./customer-display.js";
import type {
  PosCatalogItem,
  PosCategory,
  PosDiningOption,
  PosDiscount,
  PosLoyaltyProgram,
  PosPaymentMethod,
  PosTaxRate,
  PosTicketTemplate,
} from "./pos-data.js";
import type {
  PosActiveShift,
  PosOpenTicket,
  PosRegister,
  PosStore,
  PosTicketAssignee,
} from "./pos-operations.js";
import type { PosIncomingTransfer } from "./transfers.js";

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
      status: "active" | "suspended" | "archived";
      businessType: BusinessType;
      deviceManagementEnabled: boolean;
    };
    employee: {
      id: string;
      employeeNumber: string;
      jobTitle: string | null;
      name: string;
    };
    availableOrganizations: Array<{
      id: string;
      name: string;
      status: "active" | "suspended" | "archived";
    }>;
    roleNames: string[];
    permissions: string[];
    storeIds: string[];
    stores: PosStore[];
    registers: PosRegister[];
    features: Record<string, boolean>;
    activeShift: PosActiveShift | null;
  };
};

export type PosSupportWorkspace = {
  stores: PosStore[];
  categories: PosCategory[];
  registers: PosRegister[];
  paymentMethods: PosPaymentMethod[];
  loyaltyProgram: PosLoyaltyProgram | null;
  discounts: PosDiscount[];
  taxRates: PosTaxRate[];
  diningOptions: PosDiningOption[];
  ticketTemplates: PosTicketTemplate[];
  customerDisplaySessions: PosCustomerDisplaySession[];
  timeClockEntry: TimeClockEntry | null;
  activeShift: PosActiveShift | null;
  initialItems: PosCatalogItem[];
  initialFavoriteItems: PosCatalogItem[];
  initialRecentItems: PosCatalogItem[];
  openTickets: PosOpenTicket[];
  ticketAssignees: PosTicketAssignee[];
  canReceiveIncomingTransfers: boolean;
  incomingTransfers: PosIncomingTransfer[];
};

export type PosLiveV2Response = {
  ok: true;
  version: 2;
  requestId: string;
  organizationId: string;
  storeId: string | null;
  registerId: string | null;
  live: {
    timeClockEntry: TimeClockEntry | null;
    customerDisplaySessions: PosCustomerDisplaySession[];
    canReceiveIncomingTransfers: boolean;
    incomingTransfers: PosIncomingTransfer[];
    openTickets: PosOpenTicket[];
    ticketAssignees: PosTicketAssignee[];
  };
};
