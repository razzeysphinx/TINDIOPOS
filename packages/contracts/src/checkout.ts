import { z } from "zod";

export const POS_CHECKOUT_PATH = "/api/pos/v2/checkout" as const;
export const POS_CHECKOUT_RPC = "checkout_advanced_sale" as const;
export const POS_CHECKOUT_STOCK_WARNING_RPC = "get_checkout_stock_warning" as const;
export const POS_CHECKOUT_PERMISSIONS = [
  "pos.access",
  "sales.create",
  "payments.accept",
] as const;
export const POS_CHECKOUT_DISCOUNT_PERMISSION = "discounts.apply" as const;
export const POS_CHECKOUT_TICKET_PERMISSION = "tickets.manage" as const;

export const POS_CHECKOUT_REQUEST_INVALID_MESSAGE =
  "The checkout data is invalid. Return to the cart and try again." as const;
export const POS_CHECKOUT_PERMISSION_MESSAGE =
  "You do not have permission to complete sales." as const;
export const POS_CHECKOUT_INPUT_MESSAGE =
  "Check the payments and cart, then try again." as const;
export const POS_CHECKOUT_STORE_MESSAGE =
  "You are not assigned to this store." as const;
export const POS_CHECKOUT_DISCOUNT_MESSAGE =
  "You do not have permission to apply discounts." as const;
export const POS_CHECKOUT_TICKET_MESSAGE =
  "You do not have permission to use open tickets." as const;
export const POS_CHECKOUT_UNCONFIRMED_MESSAGE =
  "TINDIO could not confirm this sale. Check Recent receipts before retrying." as const;

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

export type CheckoutDeviceCredential = {
  deviceId: string;
  secret: string;
  appVersion: string;
};

const checkoutDeviceCredentialSchema = z.object({
  deviceId: z.uuid(),
  secret: z.string().regex(/^[0-9a-fA-F]{64}$/),
  appVersion: z.string().trim().min(1).max(80),
});

const moneyAmountSchema = z
  .string()
  .trim()
  .regex(/^\d{1,10}(?:\.\d{1,2})?$/, "Enter an amount with up to 2 decimal places.");

export const checkoutItemSchema = z.object({
  productId: z.uuid(),
  variantId: z.uuid().nullable(),
  quantity: z
    .number()
    .min(0.001)
    .max(10_000)
    .refine((value) => Number.isInteger(value * 1_000), "Use up to 3 decimal places."),
  unitPriceMinor: z.number().int().min(1).max(9_999_999_999).nullable().optional(),
  modifierOptionIds: z.array(z.uuid()).max(50).default([]),
  itemNote: z.string().trim().max(500).nullable().optional(),
});

export const validateCartStockSchema = z.object({
  storeId: z.uuid(),
  registerId: z.uuid(),
  items: z.array(checkoutItemSchema.pick({
    productId: true,
    variantId: true,
    quantity: true,
  })).min(1).max(100),
}) satisfies z.ZodType<ValidateCartStockValues>;

export const checkoutPaymentSchema = z
  .object({
    paymentMethodId: z.uuid(),
    amount: moneyAmountSchema.optional(),
    tenderedAmount: moneyAmountSchema.optional(),
    referenceNumber: z.string().trim().max(120),
    note: z.string().trim().max(500),
  })
  .superRefine((value, context) => {
    if (!value.amount && !value.tenderedAmount) {
      context.addIssue({
        code: "custom",
        path: ["amount"],
        message: "Enter a payment amount.",
      });
    }

    if (value.amount && value.tenderedAmount) {
      context.addIssue({
        code: "custom",
        path: ["amount"],
        message: "Use either an applied amount or cash tender, not both.",
      });
    }
  });

export const checkoutSaleSchema = z
  .object({
    storeId: z.uuid(),
    registerId: z.uuid(),
    idempotencyKey: z.uuid(),
    customerId: z.uuid().nullable(),
    loyaltyRedemptionPoints: z.number().int().min(0).max(100_000_000),
    discountId: z.uuid().nullable(),
    taxRateId: z.uuid().nullable(),
    diningOptionId: z.uuid().nullable(),
    openTicketId: z.uuid().nullable(),
    offlineExpectedTotalMinor: z.number().int().min(1).max(1_000_000_000_000).optional(),
    items: z.array(checkoutItemSchema).min(1).max(100),
    payments: z.array(checkoutPaymentSchema).min(1).max(10),
  })
  .superRefine((value, context) => {
    const itemKeys = value.items.map(
      (item) => `${item.productId}:${item.variantId ?? "simple"}`,
    );

    if (new Set(itemKeys).size !== itemKeys.length) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Each item can only appear once in a checkout.",
      });
    }
  }) satisfies z.ZodType<CheckoutSaleValues>;

export const offlineCheckoutMetadataSchema = z.object({
  localReceiptReference: z.string().trim().regex(/^OFF-[A-Z0-9]{6,32}$/),
  createdAt: z.iso.datetime(),
  shiftId: z.uuid(),
  deviceId: z.uuid().nullable(),
  deviceSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
});

export const checkoutSubmissionSchema = z.object({
  checkout: checkoutSaleSchema,
  device: checkoutDeviceCredentialSchema.nullable(),
  offline: offlineCheckoutMetadataSchema.optional(),
});

export type CheckoutSubmission = z.infer<typeof checkoutSubmissionSchema>;
