import type {
  PosCatalogItem,
  PosCustomer,
} from "@tindio/contracts";

export type {
  PosCatalogItem,
  PosCatalogResponse,
  PosCategory,
  PosCustomer,
  PosDiningOption,
  PosDiscount,
  PosLoyaltyProgram,
  PosPaymentMethod,
  PosTaxRate,
  PosTicketTemplate,
} from "@tindio/contracts";

export type PosFavoriteTileActionResult =
  | { ok: true; isFavorite: boolean; message: string }
  | { ok: false; message: string };

export type PosStore = {
  id: string;
  name: string;
};

export type PosRegister = {
  id: string;
  storeId: string;
  name: string;
  code: string;
};

export type PosActiveShift = {
  id: string;
  storeId: string;
  registerId: string;
  openingCashMinor: number;
  openedAt: string;
};

export type PosOpenTicket = {
  id: string;
  label: string;
  note: string | null;
  customer: PosCustomer | null;
  diningOptionId: string | null;
  assignedEmployeeId: string | null;
  cart: PosCartLine[];
  updatedAt: string;
};

export type PosTicketAssignee = {
  id: string;
  fullName: string;
};

/**
 * A read-only projection of a canonical transfer document for the receiving
 * POS. Stock changes only through the existing transfer receipt RPCs.
 */
export type PosIncomingTransfer = {
  id: string;
  transferNumber: number;
  stockRequestId: string | null;
  sourceStoreId: string;
  sourceStoreName: string;
  destinationStoreId: string;
  destinationStoreName: string;
  status: ReceivableTransferStatus;
  note: string | null;
  lines: Array<{
    id: string;
    label: string;
    unit: string;
    quantity: number;
    receivedQuantity: number;
    shortQuantity: number;
  }>;
};

export type PosCartLine = PosCatalogItem & {
  quantity: number;
  manualPriceMinor: number | null;
  modifierOptionIds: string[];
  /** Stable only after a line is saved to an open ticket. */
  ticketLineId?: string;
  /** A line-specific instruction, distinct from the ticket-wide order note. */
  itemNote?: string | null;
  modifiers?: Array<{ id: string; name: string; priceMinor: number }>;
};

export function posItemKey(item: Pick<PosCatalogItem, "productId" | "variantId"> & { modifierOptionIds?: string[]; manualPriceMinor?: number | null; ticketLineId?: string; itemNote?: string | null }) {
  if (item.ticketLineId) return `ticket:${item.ticketLineId}`;

  return `${item.productId}:${item.variantId ?? "simple"}:${item.manualPriceMinor ?? "catalog"}:${[...(item.modifierOptionIds ?? [])].sort().join(",")}:${item.itemNote ?? ""}`;
}
import type { ReceivableTransferStatus } from "@/features/inventory/inventory-transfer-reader-contract";
