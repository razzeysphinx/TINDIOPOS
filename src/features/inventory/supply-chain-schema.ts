import { z } from "zod";

const uuid = z.uuid("Choose a valid record.");

const positiveQuantity = z
  .string()
  .trim()
  .regex(/^\d{1,8}(?:\.\d{1,3})?$/, "Use a positive quantity with up to 3 decimals.")
  .refine((value) => Number(value) > 0, "Quantity must be greater than zero.");

const nonNegativeQuantity = z
  .string()
  .trim()
  .regex(/^\d{1,8}(?:\.\d{1,3})?$/, "Use a non-negative quantity with up to 3 decimals.");

const saleableLine = z.object({
  productId: uuid,
  variantId: z.string().refine((value) => value === "" || z.uuid().safeParse(value).success, {
    message: "Choose a valid item option.",
  }),
});

function hasUniqueSaleables(lines: Array<{ productId: string; variantId: string }>) {
  return new Set(lines.map((line) => `${line.productId}|${line.variantId}`)).size === lines.length;
}

export const createWarehouseSchema = z.object({
  storeId: uuid,
  code: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_-]{1,39}$/, "Use 2–40 letters, numbers, hyphens, or underscores."),
  name: z.string().trim().min(2, "Enter a warehouse name.").max(120),
  notes: z.string().trim().max(500),
});

export const updateSupplierLeadTimeSchema = z.object({
  supplierId: uuid,
  leadTimeDays: z
    .string()
    .trim()
    .regex(/^\d{1,3}$/, "Use a whole number of days.")
    .refine((value) => Number(value) <= 365, "Lead time cannot exceed 365 days."),
});

export const upsertReplenishmentRuleSchema = z
  .object({
    storeId: uuid,
    productId: uuid,
    variantId: z.string().refine((value) => value === "" || z.uuid().safeParse(value).success, {
      message: "Choose a valid item option.",
    }),
    preferredWarehouseId: z.string().refine((value) => value === "" || z.uuid().safeParse(value).success, {
      message: "Choose a valid warehouse.",
    }),
    reorderPoint: nonNegativeQuantity,
    targetStock: positiveQuantity,
  })
  .superRefine((value, context) => {
    if (Number(value.targetStock) < Number(value.reorderPoint)) {
      context.addIssue({
        code: "custom",
        path: ["targetStock"],
        message: "Target stock must be at least the reorder point.",
      });
    }
  });

export const createStockRequestSchema = z
  .object({
    requestingStoreId: uuid,
    sourceWarehouseId: uuid,
    note: z.string().trim().max(500),
    lines: z.array(saleableLine.extend({ quantity: positiveQuantity })).min(1).max(100),
  })
  .superRefine((value, context) => {
    if (!hasUniqueSaleables(value.lines)) {
      context.addIssue({ code: "custom", path: ["lines"], message: "Each item can appear only once in a request." });
    }
  });

export const approveStockRequestSchema = z
  .object({
    stockRequestId: uuid,
    lines: z
      .array(
        z.object({
          stockRequestLineId: uuid,
          approvedQuantity: nonNegativeQuantity,
        }),
      )
      .min(1)
      .max(100),
  })
  .superRefine((value, context) => {
    if (new Set(value.lines.map((line) => line.stockRequestLineId)).size !== value.lines.length) {
      context.addIssue({ code: "custom", path: ["lines"], message: "Each request line can be approved once." });
    }
    if (!value.lines.some((line) => Number(line.approvedQuantity) > 0)) {
      context.addIssue({ code: "custom", path: ["lines"], message: "Approve at least one item." });
    }
  });

export const requestIdentifierSchema = z.object({ stockRequestId: uuid });

export const dispatchStockRequestSchema = requestIdentifierSchema.extend({
  note: z.string().trim().max(500),
});

export const receiveStockRequestSchema = z
  .object({
    stockRequestId: uuid,
    note: z.string().trim().max(500),
    lines: z
      .array(
        z.object({
          stockTransferLineId: uuid,
          receivedQuantity: nonNegativeQuantity,
          shortQuantity: nonNegativeQuantity,
          discrepancyNote: z.string().trim().max(500),
        }),
      )
      .min(1)
      .max(100),
  })
  .superRefine((value, context) => {
    if (new Set(value.lines.map((line) => line.stockTransferLineId)).size !== value.lines.length) {
      context.addIssue({ code: "custom", path: ["lines"], message: "Each transfer line can be received once per submission." });
    }

    for (const [index, line] of value.lines.entries()) {
      if (Number(line.receivedQuantity) + Number(line.shortQuantity) <= 0) {
        context.addIssue({ code: "custom", path: ["lines", index], message: "Enter a received or short quantity." });
      }
      if (Number(line.shortQuantity) > 0 && line.discrepancyNote.length < 2) {
        context.addIssue({ code: "custom", path: ["lines", index, "discrepancyNote"], message: "Explain the shortage or discrepancy." });
      }
    }
  });
