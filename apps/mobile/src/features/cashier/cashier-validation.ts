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
  if (input.customerId || input.diningOptionId || input.openTicketId) return false;

  return cart.length > 0 && cart.every((line) =>
    !line.isVariablePrice
    && line.manualPriceMinor === null
    && line.modifierOptionIds.length === 0
    && (line.modifiers?.length ?? 0) === 0
    && !(line.itemNote ?? "").trim()
    && Number.isFinite(line.quantity)
    && line.quantity > 0
    && (line.allowFractionalQuantity || Number.isInteger(line.quantity)),
  );
}
