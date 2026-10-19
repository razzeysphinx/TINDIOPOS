import type {
  PosCatalogItem,
} from "@tindio/contracts";

export type {
  PosCartLine,
  PosCatalogItem,
  PosCatalogResponse,
  PosCategory,
  PosCustomer,
  PosDiningOption,
  PosDiscount,
  PosLoyaltyProgram,
  PosActiveShift,
  PosOpenTicket,
  PosPaymentMethod,
  PosRegister,
  PosStore,
  PosTaxRate,
  PosTicketAssignee,
  PosTicketTemplate,
} from "@tindio/contracts";

export type PosFavoriteTileActionResult =
  | { ok: true; isFavorite: boolean; message: string }
  | { ok: false; message: string };

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

export function posItemKey(item: Pick<PosCatalogItem, "productId" | "variantId"> & { modifierOptionIds?: string[]; manualPriceMinor?: number | null; ticketLineId?: string; itemNote?: string | null }) {
  if (item.ticketLineId) return `ticket:${item.ticketLineId}`;

  return `${item.productId}:${item.variantId ?? "simple"}:${item.manualPriceMinor ?? "catalog"}:${[...(item.modifierOptionIds ?? [])].sort().join(",")}:${item.itemNote ?? ""}`;
}
import type { ReceivableTransferStatus } from "@/features/inventory/inventory-transfer-reader-contract";
