import { z } from "zod";

import { posDeviceCredentialSchema } from "@/features/devices/device-schema";

const moneyAmount = z
  .string()
  .trim()
  .regex(/^\d{1,10}(?:\.\d{1,2})?$/, "Enter an amount with up to 2 decimal places.");

const checkoutItemSchema = z.object({
  productId: z.uuid(),
  variantId: z.uuid().nullable(),
  quantity: z
    .number()
    .min(0.001)
    .max(10000)
    .refine((value) => Number.isInteger(value * 1000), "Use up to 3 decimal places."),
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
});

export type ValidateCartStockValues = z.infer<typeof validateCartStockSchema>;

const checkoutPaymentSchema = z
  .object({
    paymentMethodId: z.uuid(),
    amount: moneyAmount.optional(),
    tenderedAmount: moneyAmount.optional(),
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
  });

export type CheckoutSaleValues = z.infer<typeof checkoutSaleSchema>;

export const offlineCheckoutMetadataSchema = z.object({
  localReceiptReference: z.string().trim().regex(/^OFF-[A-Z0-9]{6,32}$/),
  createdAt: z.iso.datetime(),
  shiftId: z.uuid(),
  deviceId: z.uuid().nullable(),
});

export const checkoutSubmissionSchema = z.object({
  checkout: checkoutSaleSchema,
  device: posDeviceCredentialSchema.nullable(),
  offline: offlineCheckoutMetadataSchema.optional(),
});

export type CheckoutSubmission = z.infer<typeof checkoutSubmissionSchema>;
