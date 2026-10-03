import type {
  PosCartLine,
  PosDiscount,
  PosTaxRate,
} from "../../../../../src/features/pos/pos-types";

export type LocalCartTotals = {
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
};

const roundMinor = (value: number) => Math.round(value);

export function localCartLineTotalMinor(line: PosCartLine) {
  const baseMinor = line.manualPriceMinor ?? line.priceMinor;
  const modifierMinor = (line.modifiers ?? []).reduce(
    (total, modifier) => total + modifier.priceMinor,
    0,
  );

  return roundMinor((baseMinor + modifierMinor) * line.quantity);
}

export function calculateLocalCartTotals(
  lines: PosCartLine[],
  discount: PosDiscount | null,
  tax: PosTaxRate | null,
): LocalCartTotals {
  const subtotalMinor = lines.reduce(
    (total, line) => total + localCartLineTotalMinor(line),
    0,
  );

  let discountMinor = 0;

  if (discount?.discountType === "percentage" && discount.percentageBps !== null) {
    discountMinor = roundMinor(subtotalMinor * discount.percentageBps / 10_000);
  }

  if (discount?.discountType === "fixed_amount" && discount.amountMinor !== null) {
    discountMinor = Math.min(subtotalMinor, discount.amountMinor);
  }

  const discountedMinor = Math.max(0, subtotalMinor - discountMinor);

  let taxMinor = 0;
  let totalMinor = discountedMinor;

  if (tax) {
    taxMinor = roundMinor(
      discountedMinor * tax.rateBps / (tax.isInclusive ? 10_000 + tax.rateBps : 10_000),
    );

    if (!tax.isInclusive) totalMinor += taxMinor;
  }

  return {
    subtotalMinor,
    discountMinor,
    taxMinor,
    totalMinor,
  };
}
