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

export { posItemKey } from "@tindio/contracts/cart";

export type PosFavoriteTileActionResult =
  | { ok: true; isFavorite: boolean; message: string }
  | { ok: false; message: string };
