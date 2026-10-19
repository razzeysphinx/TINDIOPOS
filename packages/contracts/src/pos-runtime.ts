import type { TimeClockEntry } from "./attendance";
import type { PosCustomerDisplaySession } from "./customer-display";
import type {
  PosCatalogItem,
  PosCategory,
  PosDiningOption,
  PosDiscount,
  PosLoyaltyProgram,
  PosPaymentMethod,
  PosTaxRate,
  PosTicketTemplate,
} from "./pos-data";
import type {
  PosActiveShift,
  PosOpenTicket,
  PosRegister,
  PosStore,
  PosTicketAssignee,
} from "./pos-operations";
import type { PosIncomingTransfer } from "./transfers";

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
