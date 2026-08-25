export type PosCatalogItem = {
  productId: string;
  variantId: string | null;
  categoryId: string | null;
  productName: string;
  variantName: string | null;
  sku: string | null;
  barcode: string | null;
  priceMinor: number;
  unit: string;
  imageUrl: string | null;
  isVariablePrice: boolean;
  allowFractionalQuantity: boolean;
  hasModifiers?: boolean;
};

export type PosCategory = {
  id: string;
  name: string;
  color: string | null;
};

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

export type PosPaymentMethod = {
  id: string;
  storeId: string;
  name: string;
  code: string;
  type: "CASH" | "CARD" | "E_WALLET" | "BANK_TRANSFER" | "VOUCHER" | "OTHER";
  offlinePolicy: "disabled" | "cash" | "manual_external";
  requiresReference: boolean;
  sortOrder: number;
};

export type PosCustomer = {
  id: string;
  customerNumber: number;
  loyaltyCardCode: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  loyaltyPoints: number;
};

export type PosLoyaltyProgram = {
  isEnabled: boolean;
  earnSpendMinor: number;
  earnPoints: number;
  redemptionValueMinor: number;
  minimumRedemptionPoints: number;
};

export type PosDiscount = {
  id: string;
  name: string;
  discountType: "percentage" | "fixed_amount";
  percentageBps: number | null;
  amountMinor: number | null;
};

export type PosTaxRate = {
  id: string;
  name: string;
  rateBps: number;
  isInclusive: boolean;
  isDefault: boolean;
};

export type PosDiningOption = {
  id: string;
  name: string;
  isDefault: boolean;
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

export type PosTicketTemplate = {
  id: string;
  label: string;
  note: string | null;
  diningOptionId: string | null;
};

export type PosTicketAssignee = {
  id: string;
  fullName: string;
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

export type PosCatalogResponse = {
  items: PosCatalogItem[];
  hasMore: boolean;
};

export function posItemKey(item: Pick<PosCatalogItem, "productId" | "variantId"> & { modifierOptionIds?: string[]; manualPriceMinor?: number | null; ticketLineId?: string; itemNote?: string | null }) {
  if (item.ticketLineId) return `ticket:${item.ticketLineId}`;

  return `${item.productId}:${item.variantId ?? "simple"}:${item.manualPriceMinor ?? "catalog"}:${[...(item.modifierOptionIds ?? [])].sort().join(",")}:${item.itemNote ?? ""}`;
}
