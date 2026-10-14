import type { PosCartLine } from "../../../../../src/contracts/pos";

export function parseMoneyToMinor(value: string) {
  const match = value.trim().match(/^(\d{1,10})(?:\.(\d{1,2}))?$/);
  if (!match) return null;

  return Number(match[1]) * 100 + Number(`${match[2] ?? ""}00`.slice(0, 2));
}

export function minorToMoney(minor: number) {
  return (minor / 100).toFixed(2);
}

export function normalizeQuantity(value: string | number, allowFractionalQuantity: boolean) {
  const parsed = typeof value === "number" ? value : Number(value.trim());

  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 10_000) {
    return null;
  }

  if (!allowFractionalQuantity) {
    return Number.isInteger(parsed) ? parsed : null;
  }

  const normalized = Math.round(parsed * 1_000) / 1_000;
  return Number.isInteger(normalized * 1_000) ? normalized : null;
}

export function sameSaleable(
  left: Pick<PosCartLine, "productId" | "variantId">,
  right: Pick<PosCartLine, "productId" | "variantId">,
) {
  return left.productId === right.productId && left.variantId === right.variantId;
}

export function sameConfiguration(left: PosCartLine, right: PosCartLine) {
  return (
    sameSaleable(left, right)
    && left.manualPriceMinor === right.manualPriceMinor
    && [...left.modifierOptionIds].sort().join(",") === [...right.modifierOptionIds].sort().join(",")
    && (left.itemNote ?? "") === (right.itemNote ?? "")
  );
}

export function cartSupportsDurableOfflineCash(
  cart: PosCartLine[],
  input: {
    customerId: string | null;
    diningOptionId: string | null;
    openTicketId: string | null;
  },
) {
  return offlineCashCartRestriction(cart, input) === null;
}

export type OfflineCashCartRestriction =
  | "EMPTY_CART"
  | "CUSTOMER_REQUIRES_CONNECTIVITY"
  | "DINING_REQUIRES_CONNECTIVITY"
  | "OPEN_TICKET_REQUIRES_CONNECTIVITY"
  | "VARIABLE_PRICE_REQUIRES_CONNECTIVITY"
  | "MODIFIERS_REQUIRE_CONNECTIVITY"
  | "ITEM_NOTE_REQUIRES_CONNECTIVITY"
  | "INVALID_QUANTITY";

export function offlineCashCartRestriction(
  cart: PosCartLine[],
  input: {
    customerId: string | null;
    diningOptionId: string | null;
    openTicketId: string | null;
  },
): OfflineCashCartRestriction | null {
  if (cart.length === 0) return "EMPTY_CART";
  if (input.customerId) return "CUSTOMER_REQUIRES_CONNECTIVITY";
  if (input.openTicketId) return "OPEN_TICKET_REQUIRES_CONNECTIVITY";
  if (input.diningOptionId) return "DINING_REQUIRES_CONNECTIVITY";

  for (const line of cart) {
    if (!Number.isFinite(line.quantity)
      || line.quantity <= 0
      || (!line.allowFractionalQuantity && !Number.isInteger(line.quantity))) {
      return "INVALID_QUANTITY";
    }
    if (line.isVariablePrice || line.manualPriceMinor !== null) {
      return "VARIABLE_PRICE_REQUIRES_CONNECTIVITY";
    }
    if (line.modifierOptionIds.length > 0 || (line.modifiers?.length ?? 0) > 0) {
      return "MODIFIERS_REQUIRE_CONNECTIVITY";
    }
    if ((line.itemNote ?? "").trim()) return "ITEM_NOTE_REQUIRES_CONNECTIVITY";
  }

  return null;
}

export function offlineCashCartRestrictionMessage(restriction: OfflineCashCartRestriction) {
  switch (restriction) {
    case "CUSTOMER_REQUIRES_CONNECTIVITY":
      return "This cart has a customer. Reconnect or remove the customer before collecting offline cash payment.";
    case "OPEN_TICKET_REQUIRES_CONNECTIVITY":
      return "Open-ticket checkout requires connectivity. Reconnect before collecting payment.";
    case "DINING_REQUIRES_CONNECTIVITY":
      return "This dining order requires connectivity. Reconnect before collecting payment.";
    case "VARIABLE_PRICE_REQUIRES_CONNECTIVITY":
      return "Variable or manually priced items require connectivity. Reconnect before collecting payment.";
    case "MODIFIERS_REQUIRE_CONNECTIVITY":
      return "Item modifiers require connectivity. Reconnect before collecting payment.";
    case "ITEM_NOTE_REQUIRES_CONNECTIVITY":
      return "Item notes require connectivity. Reconnect before collecting payment.";
    case "INVALID_QUANTITY":
      return "Correct the item quantity before collecting payment.";
    case "EMPTY_CART":
      return "Add an item before collecting payment.";
  }
}
