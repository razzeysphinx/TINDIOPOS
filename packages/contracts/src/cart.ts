import type { PosCatalogItem } from "./pos-data";

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
  options: PosModifierOption[];
};

export type PosModifierResponse = {
  groups: PosModifierGroup[];
};

export type PosModifiersV2Response = {
  ok: true;
  version: 2;
  requestId: string;
  organizationId: string;
  storeId: string;
  productId: string;
  groups: PosModifierGroup[];
};

export type PosCartLine = PosCatalogItem & {
  quantity: number;
  manualPriceMinor: number | null;
  modifierOptionIds: string[];
  /** Stable only after a line is saved to an open ticket. */
  ticketLineId?: string;
  /** A line-specific instruction, distinct from the ticket-wide order note. */
  itemNote?: string | null;
  modifiers?: PosModifierOption[];
};
