export type CheckoutSaleItemValues = {
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPriceMinor?: number | null;
  modifierOptionIds: string[];
  itemNote?: string | null;
};

export type CheckoutSalePaymentValues = {
  paymentMethodId: string;
  amount?: string;
  tenderedAmount?: string;
  referenceNumber: string;
  note: string;
};

export type CheckoutSaleValues = {
  storeId: string;
  registerId: string;
  idempotencyKey: string;
  customerId: string | null;
  loyaltyRedemptionPoints: number;
  discountId: string | null;
  taxRateId: string | null;
  diningOptionId: string | null;
  openTicketId: string | null;
  offlineExpectedTotalMinor?: number;
  items: CheckoutSaleItemValues[];
  payments: CheckoutSalePaymentValues[];
};

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

export type CheckoutSequenceInfo = {
  deviceSequence: number;
  serverCheckpoint: number;
  expectedSequence: number;
  status:
    | "ACCEPTED"
    | "REPLAY"
    | "GAP"
    | "DUPLICATE_SEQUENCE"
    | "OUT_OF_ORDER"
    | "IDEMPOTENCY_SEQUENCE_MISMATCH";
};

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
      sync?: CheckoutSequenceInfo;
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
        | "DEVICE_REVOKED"
        | "SEQUENCE_GAP"
        | "SEQUENCE_CONFLICT"
        | "SEQUENCE_OUT_OF_ORDER";
      sync?: CheckoutSequenceInfo;
    };

export type ValidateCartStockValues = {
  storeId: string;
  registerId: string;
  items: Array<{
    productId: string;
    variantId: string | null;
    quantity: number;
  }>;
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
