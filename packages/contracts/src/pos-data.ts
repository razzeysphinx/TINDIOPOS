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

export type PosTicketTemplate = {
  id: string;
  label: string;
  note: string | null;
  diningOptionId: string | null;
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
    loyaltyProgram: PosLoyaltyProgram | null;
    discounts: PosDiscount[];
    taxRates: PosTaxRate[];
    diningOptions: PosDiningOption[];
    ticketTemplates: PosTicketTemplate[];
  };
};

export type PosCatalogV2Response = {
  ok: true;
  version: 2;
  requestId: string;
  organizationId: string;
  storeId: string;
  mode: "search" | "favorites" | "recent";
  offset: number;
  limit: number;
  items: PosCatalogItem[];
  hasMore: boolean;
};

export type PosCatalogResponse = {
  items: PosCatalogItem[];
  hasMore: boolean;
};

export type PosCustomerSearchResponse = {
  customers: PosCustomer[];
};
