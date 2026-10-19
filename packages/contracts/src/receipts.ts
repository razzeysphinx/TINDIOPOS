export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue | undefined }
  | JsonValue[];

export type PosReceiptPaymentType =
  | "CASH"
  | "CARD"
  | "E_WALLET"
  | "BANK_TRANSFER"
  | "VOUCHER"
  | "OTHER";

export type PosReceiptSummary = {
  receipt_id: string;
  sale_id: string;
  receipt_number: number;
  issued_at: string;
  store_id: string;
  register_id: string;
  store_name: string;
  register_name: string;
  cashier_name: string;
  total_minor: number;
  currency_code: string;
  refund_total_minor: number;
  refund_count: number;
  has_refundable_quantity: boolean;
  payment_methods: Array<{
    name: string;
    type: PosReceiptPaymentType;
  }>;
};

export type PosReceiptDetail = {
  receipt: {
    id: string;
    number: number;
    issuedAt: string;
    layout: JsonValue | null;
  };
  customerEmail: string | null;
  sale: {
    id: string;
    storeId: string;
    registerId: string;
    currencyCode: string;
    organizationName: string;
    storeName: string;
    registerName: string;
    cashierName: string;
    subtotalMinor: number;
    discountMinor: number;
    taxMinor: number;
    totalMinor: number;
  };
  items: Array<{
    id: string;
    name: string;
    sku: string | null;
    quantity: number;
    unit: string;
    unitPriceMinor: number;
    lineTotalMinor: number;
  }>;
  payments: Array<{
    id: string;
    name: string;
    type: PosReceiptPaymentType;
    amountMinor: number;
    tenderedMinor: number | null;
    changeMinor: number | null;
    referenceNumber: string | null;
  }>;
  refunds: Array<{
    id: string;
    number: number;
    totalMinor: number;
    completedAt: string;
    reason: string;
    paymentName: string | null;
    paymentReference: string | null;
    items: Array<{
      id: string;
      saleItemId: string;
      name: string;
      quantity: number;
      unit: string;
      lineTotalMinor: number;
    }>;
  }>;
};

export type PosReceiptListResponse = {
  receipts: PosReceiptSummary[];
  hasMore: boolean;
};
