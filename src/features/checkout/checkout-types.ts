export type CheckoutPaymentSummary = {
  paymentMethodId: string;
  name: string;
  code: string;
  type: "CASH" | "CARD" | "E_WALLET" | "BANK_TRANSFER" | "VOUCHER" | "OTHER";
  amountMinor: number;
  tenderedMinor: number | null;
  changeMinor: number | null;
  referenceNumber: string | null;
  note: string | null;
};

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

export type CheckoutSaleActionResult =
  | {
      ok: true;
      message: string;
      data: {
        saleId: string;
        receiptNumber: number;
        totalMinor: number;
        changeMinor: number;
        payments: CheckoutPaymentSummary[];
        wasReplayed: boolean;
        inventoryWarning: string | null;
      };
    }
  | {
      ok: false;
      message: string;
      retryable: boolean;
      failureCode?:
        | "DUPLICATE_TRANSACTION"
        | "INVALID_SHIFT"
        | "CLOSED_SHIFT"
        | "PRODUCT_ARCHIVED"
        | "PRICE_CHANGED"
        | "TAX_CHANGED"
        | "CUSTOMER_INVALID"
        | "INVENTORY_CONFLICT"
        | "PERMISSION_CHANGED"
        | "REGISTER_REVOKED"
        | "DEVICE_REVOKED";
    };
