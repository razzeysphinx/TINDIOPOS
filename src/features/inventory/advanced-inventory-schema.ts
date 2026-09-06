import { z } from "zod";

const optionalUuid = z
  .string()
  .refine((value) => value === "" || z.uuid().safeParse(value).success, {
    message: "Select a valid option.",
  });

const operationId = z.uuid("Start the operation again and retry.");

const quantity = z
  .string()
  .trim()
  .regex(/^\d{1,8}(?:\.\d{1,3})?$/, "Use a positive quantity with up to 3 decimals.")
  .refine((value) => Number(value) > 0, "Quantity must be greater than zero.");

const countedQuantity = z
  .string()
  .trim()
  .regex(/^\d{1,8}(?:\.\d{1,3})?$/, "Use a non-negative quantity with up to 3 decimals.");

const quantityDelta = z
  .string()
  .trim()
  .regex(/^-?\d{1,8}(?:\.\d{1,3})?$/, "Use a quantity with up to 3 decimals.")
  .refine((value) => Number(value) !== 0, "Quantity cannot be zero.");

const unitCost = z
  .string()
  .trim()
  .regex(/^\d{1,8}(?:\.\d{1,2})?$/, "Use a valid amount with up to 2 decimals.");

const saleableLine = z.object({
  productId: z.uuid("Select an item."),
  variantId: optionalUuid,
});

const uniqueSaleableLines = (value: Array<{ productId: string; variantId: string }>) =>
  new Set(value.map((line) => `${line.productId}|${line.variantId}`)).size === value.length;

export const createSupplierSchema = z.object({
  name: z.string().trim().min(1, "Enter a supplier name.").max(160),
  contactName: z.string().trim().max(160),
  email: z.string().trim().max(320).refine((value) => value === "" || z.email().safeParse(value).success, {
    message: "Enter a valid email address.",
  }),
  phone: z.string().trim().max(40),
  address: z.string().trim().max(1000),
  notes: z.string().trim().max(2000),
});

export const updateSupplierSchema = createSupplierSchema.extend({
  supplierId: z.uuid("Select a supplier."),
  isActive: z.boolean(),
});

export const importSuppliersCsvSchema = z.object({
  rows: z.array(z.object({
    rowNumber: z.number().int().min(2), name: z.string().trim().min(1).max(160), contactName: z.string().trim().max(160), email: z.string().trim().max(320), phone: z.string().trim().max(40), address: z.string().trim().max(1000), notes: z.string().trim().max(2000),
  })).min(1).max(500),
});

export const createPurchaseOrderSchema = z
  .object({
    operationId,
    storeId: z.uuid("Select a store."),
    supplierId: z.uuid("Select a supplier."),
    notes: z.string().trim().max(1000),
    expectedAt: z
      .string()
      .trim()
      .refine((value) => value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value), {
        message: "Use a valid expected date.",
      }),
    lines: z
      .array(
        saleableLine.extend({
          purchaseUnitCode: z
            .string()
            .trim()
            .regex(/^[A-Za-z0-9][A-Za-z0-9 _-]{0,23}$/, "Select a configured purchase unit."),
          quantity,
          unitCost,
        }),
      )
      .min(1, "Add an item to the order.")
      .max(100, "Use at most 100 items."),
  })
  .superRefine((value, context) => {
    if (!uniqueSaleableLines(value.lines)) {
      context.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Each item can appear only once in an order.",
      });
    }
  });

export const receivePurchaseOrderSchema = z
  .object({
    operationId,
    purchaseOrderId: z.uuid("Select a purchase order."),
    note: z.string().trim().max(500),
    lines: z
      .array(
        z.object({
          purchaseOrderLineId: z.uuid(),
          quantity,
        }),
      )
      .min(1, "Enter at least one received quantity.")
      .max(100),
  })
  .superRefine((value, context) => {
    if (
      new Set(value.lines.map((line) => line.purchaseOrderLineId)).size !== value.lines.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Each order line can be received once per receipt.",
      });
    }
  });

export const cancelPurchaseOrderSchema = z.object({
  purchaseOrderId: z.uuid("Select a purchase order."),
  note: z.string().trim().max(500),
});

export const completeInventoryCountSchema = z
  .object({
    storeId: z.uuid("Select a store."),
    note: z.string().trim().max(500),
    lines: z
      .array(
        saleableLine.extend({
          countedQuantity,
        }),
      )
      .min(1, "Add an item to the count.")
      .max(500),
  })
  .superRefine((value, context) => {
    if (!uniqueSaleableLines(value.lines)) {
      context.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Each item can appear only once in a count.",
      });
    }
  });

export const createInventoryCountDraftSchema = z
  .object({
    storeId: z.uuid("Select a store."),
    note: z.string().trim().max(500),
    countMode: z.enum(["standard", "blind"]),
    scopeType: z.enum(["full_store", "category", "supplier", "selected"]),
    scopeReferenceId: z.string().trim().optional(),
    selectedItems: z
      .array(z.object({ productId: z.uuid(), variantId: optionalUuid }))
      .max(500, "Choose no more than 500 items."),
    sortMode: z.enum(["category_name", "supplier_name", "sku", "barcode", "product_name"]),
    includeZeroStock: z.boolean(),
  })
  .superRefine((value, context) => {
    if ((value.scopeType === "category" || value.scopeType === "supplier") && !z.uuid().safeParse(value.scopeReferenceId).success) {
      context.addIssue({ code: "custom", path: ["scopeReferenceId"], message: `Select a ${value.scopeType}.` });
    }
    if (value.scopeType === "selected" && value.selectedItems.length === 0) {
      context.addIssue({ code: "custom", path: ["selectedItems"], message: "Choose at least one item." });
    }
  });

export const saveInventoryCountLineSchema = saleableLine.extend({
  inventoryCountId: z.uuid("Choose an inventory count."),
  countedQuantity,
});

export const inventoryCountTransitionSchema = z.object({
  inventoryCountId: z.uuid("Choose an inventory count."),
  note: z.string().trim().max(500).optional(),
});

export const transferStockSchema = z
  .object({
    sourceStoreId: z.uuid("Select a source store."),
    destinationStoreId: z.uuid("Select a destination store."),
    note: z.string().trim().max(500),
    lines: z
      .array(
        saleableLine.extend({
          quantity,
        }),
      )
      .min(1, "Add an item to transfer.")
      .max(100),
  })
  .superRefine((value, context) => {
    if (value.sourceStoreId === value.destinationStoreId) {
      context.addIssue({
        code: "custom",
        path: ["destinationStoreId"],
        message: "Choose a different destination store.",
      });
    }

    if (!uniqueSaleableLines(value.lines)) {
      context.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Each item can appear only once in a transfer.",
      });
    }
  });

export const updateInventoryPolicySchema = z.object({
  storeId: z.uuid("Select a store."),
  negativeStockPolicy: z.enum(["allow", "warn", "block"]),
});

export const updateOrganizationInventoryPolicySchema = z.object({
  negativeStockPolicy: z.enum(["allow", "warn", "block"]),
});

export const removeInventoryPolicyOverrideSchema = z.object({
  storeId: z.uuid("Select a store override."),
});

export const createAdjustmentReasonSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]{1,39}$/, "Use 2–40 letters, numbers, or underscores."),
  name: z.string().trim().min(2, "Enter a reason name.").max(100),
  movementType: z.enum(["ADJUSTMENT", "DAMAGE", "LOSS", "OPENING_STOCK"]),
});

export const recordInventoryAdjustmentSchema = z.object({
  operationId,
  storeId: z.uuid("Select a store."),
  reasonCode: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,39}$/, "Select an adjustment reason."),
  productId: z.uuid("Select an item."),
  variantId: optionalUuid,
  quantityDelta,
  note: z.string().trim().min(2, "Explain why this stock is changing.").max(500),
  approvalRequestId: z.uuid().nullable().optional(),
});

export const importInventoryAdjustmentsCsvSchema = z.object({
  operationId,
  storeId: z.uuid("Select a store."),
  reasonCode: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,39}$/, "Select an adjustment reason."),
  rows: z.array(z.object({ rowNumber: z.number().int().min(2), productId: z.uuid(), variantId: optionalUuid, quantityDelta, note: z.string().trim().min(2, "Each row needs an explanation.").max(500) })).min(1).max(500),
  approvalRequestId: z.uuid().nullable().optional(),
}).superRefine((value, context) => {
  if (!uniqueSaleableLines(value.rows)) context.addIssue({ code: "custom", path: ["rows"], message: "Each item can appear only once in an adjustment import." });
});

export const receiveStockTransferSchema = z
  .object({
    operationId,
    stockTransferId: z.uuid("Select a transfer."),
    note: z.string().trim().max(500),
    lines: z
      .array(z.object({ stockTransferLineId: z.uuid(), quantity }))
      .min(1, "Enter at least one received quantity.")
      .max(100),
  })
  .superRefine((value, context) => {
    if (new Set(value.lines.map((line) => line.stockTransferLineId)).size !== value.lines.length) {
      context.addIssue({ code: "custom", path: ["lines"], message: "Each transfer line can be received once per receipt." });
    }
  });

export const returnToSupplierSchema = z
  .object({
    storeId: z.uuid("Select a store."),
    supplierId: z.uuid("Select a supplier."),
    note: z.string().trim().max(500),
    lines: z.array(saleableLine.extend({ quantity })).min(1, "Add an item to return.").max(100),
  })
  .superRefine((value, context) => {
    if (!uniqueSaleableLines(value.lines)) {
      context.addIssue({ code: "custom", path: ["lines"], message: "Each item can appear only once in a return." });
    }
  });

export const produceCompositeSchema = z.object({
  storeId: z.uuid("Select a store."),
  productId: z.uuid("Select a composite item."),
  quantity,
  note: z.string().trim().max(500),
});
