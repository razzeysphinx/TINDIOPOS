const activityLabels: Record<string, string> = {
  ADJUSTMENT: "Stock correction",
  COUNT: "Stock count",
  DAMAGE: "Damaged stock",
  LOSS: "Stock loss",
  PURCHASE_RECEIPT: "Received from supplier",
  RETURN: "Returned to supplier",
  SALE: "Sold",
  SALE_REFUND: "Sale returned",
  TRANSFER_IN: "Received from another store",
  TRANSFER_OUT: "Sent to another store",
};

/** Converts internal movement codes into the business event a user recognizes. */
export function inventoryActivityLabel(movementType: string) {
  return activityLabels[movementType] ?? movementType
    .toLocaleLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
