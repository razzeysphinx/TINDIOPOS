export type InventoryStockCondition = "in_stock" | "low" | "negative" | "out_of_stock";

export const inventoryStockConditionLabels: Record<InventoryStockCondition, string> = {
  in_stock: "In stock",
  low: "Low stock",
  negative: "Negative stock",
  out_of_stock: "Out of stock",
};

export function getInventoryStockCondition({
  quantity,
  reorderPoint,
}: {
  quantity: number;
  reorderPoint: number | null;
}): InventoryStockCondition {
  if (quantity < 0) return "negative";
  if (quantity === 0) return "out_of_stock";
  if (reorderPoint !== null && quantity <= reorderPoint) return "low";
  return "in_stock";
}
