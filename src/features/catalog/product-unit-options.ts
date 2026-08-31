export const PRODUCT_UNIT_PRESETS = [
  "each",
  "piece",
  "pack",
  "box",
  "case",
  "bottle",
  "can",
  "kg",
  "g",
  "lb",
  "oz",
  "liter",
  "ml",
  "meter",
  "cm",
] as const;

/**
 * A product's `unit` is the canonical value consumed by inventory, sales,
 * purchasing, receipts, and reporting. Merge its existing organization values
 * with the standard list so custom units become reusable after their product
 * is saved, without introducing a competing unit master.
 */
export function buildProductUnitOptions(existingUnits: readonly string[]) {
  const options = new Map<string, string>();

  const add = (candidate: string) => {
    const normalized = candidate.trim().toLocaleLowerCase();
    if (normalized) options.set(normalized, normalized);
  };

  PRODUCT_UNIT_PRESETS.forEach(add);
  existingUnits.forEach(add);

  const presetValues = PRODUCT_UNIT_PRESETS.filter((unit) => options.has(unit));
  const customValues = [...options.values()]
    .filter((unit) => !PRODUCT_UNIT_PRESETS.includes(unit as (typeof PRODUCT_UNIT_PRESETS)[number]))
    .sort((left, right) => left.localeCompare(right));

  return [...presetValues, ...customValues];
}
