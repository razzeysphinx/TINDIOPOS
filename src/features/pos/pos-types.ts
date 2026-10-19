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
  PosIncomingTransfer,
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

export function posItemKey(item: Pick<PosCatalogItem, "productId" | "variantId"> & { modifierOptionIds?: string[]; manualPriceMinor?: number | null; ticketLineId?: string; itemNote?: string | null }) {
  if (item.ticketLineId) return `ticket:${item.ticketLineId}`;

  return `${item.productId}:${item.variantId ?? "simple"}:${item.manualPriceMinor ?? "catalog"}:${[...(item.modifierOptionIds ?? [])].sort().join(",")}:${item.itemNote ?? ""}`;
}
