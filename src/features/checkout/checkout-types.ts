export type {
  CheckoutPaymentSummary,
  CheckoutSaleActionResult,
  CheckoutSequenceInfo,
} from "@tindio/contracts";

export type NegativeStockPolicy = "allow" | "warn" | "block";

export type NegativeStockItem = {
  productId: string;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  availableQuantity: number;
  cartQuantity: number;
  projectedQuantity: number;
};

export type ValidateCartStockActionResult =
  | {
      ok: true;
      policy: NegativeStockPolicy;
      items: NegativeStockItem[];
      checkedAt: string;
    }
  | { ok: false; message: string };
