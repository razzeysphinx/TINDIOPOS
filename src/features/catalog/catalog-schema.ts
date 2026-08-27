import { z } from "zod";

const optionalUuid = z
  .string()
  .refine((value) => value === "" || z.uuid().safeParse(value).success, {
    message: "Select a valid option.",
  });

const sku = z
  .string()
  .trim()
  .max(64, "Use at most 64 characters.")
  .refine(
    (value) => value === "" || /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value),
    "Use letters, numbers, dots, _ or -.",
  )
  .transform((value) => value.toUpperCase());

const barcode = z
  .string()
  .trim()
  .max(64, "Use at most 64 characters.")
  .refine(
    (value) => value === "" || /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(value),
    "Use 3–64 letters, numbers, dots, _ or -.",
  );

const moneyInput = z
  .string()
  .trim()
  .regex(/^\d{1,8}(?:\.\d{1,2})?$/, "Enter a positive amount with up to 2 decimals.");

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, "Enter a category name.").max(100),
  description: z.string().trim().max(500),
  icon: z.enum([
    "shapes",
    "cup-soda",
    "utensils",
    "shirt",
    "smartphone",
    "package",
  ]),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Choose a valid color.")
    .transform((value) => value.toUpperCase()),
  sortOrder: z.number().int().min(0).max(100000),
});

export const setCategoryArchivedSchema = z.object({
  categoryId: z.uuid(),
  isArchived: z.boolean(),
});

export const updateCategorySchema = createCategorySchema.extend({
  categoryId: z.uuid(),
});

export const productVariantSchema = z.object({
  name: z.string().trim().min(1, "Enter a variant name.").max(160),
  sku,
  barcode,
  price: moneyInput,
  cost: moneyInput,
});

export const createProductSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a product name.").max(160),
    description: z.string().trim().max(2000),
    categoryId: optionalUuid,
    productType: z.enum(["simple", "variable", "composite"]),
    sku,
    barcode,
    price: moneyInput,
    cost: moneyInput,
    trackInventory: z.boolean(),
    imageUrl: z
      .string()
      .trim()
      .max(2048, "Use an image URL with at most 2,048 characters.")
      .refine((value) => value === "" || /^https?:\/\//i.test(value), "Enter a full http(s) image URL."),
    isVariablePrice: z.boolean(),
    allowFractionalQuantity: z.boolean(),
    unit: z
      .string()
      .trim()
      .min(1, "Enter a unit.")
      .max(24)
      .regex(/^[A-Za-z][A-Za-z0-9 _-]*$/, "Use letters, numbers, spaces, _ or -."),
    storeIds: z.array(z.uuid()).min(1, "Select at least one store.").max(100),
    variants: z.array(productVariantSchema).max(100),
  })
  .superRefine((value, context) => {
    if (new Set(value.storeIds).size !== value.storeIds.length) {
      context.addIssue({
        code: "custom",
        path: ["storeIds"],
        message: "Each store can only be selected once.",
      });
    }

    if ((value.productType === "simple" || value.productType === "composite") && value.variants.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["variants"],
        message: "Only variant products can contain saleable variants.",
      });
    }

    if (value.productType === "variable") {
      if (value.variants.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["variants"],
          message: "Add at least one variant.",
        });
      }

      if (value.sku || value.barcode) {
        context.addIssue({
          code: "custom",
          path: ["sku"],
          message: "Add SKU and barcode values to each variant instead.",
        });
      }
    }

    if (value.isVariablePrice && value.productType === "variable") {
      context.addIssue({
        code: "custom",
        path: ["isVariablePrice"],
        message: "Variable-price mode is available for simple and composite products.",
      });
    }

    const identifiers = [
      value.sku,
      value.barcode,
      ...value.variants.flatMap((variant) => [variant.sku, variant.barcode]),
    ].filter(Boolean);

    if (new Set(identifiers).size !== identifiers.length) {
      context.addIssue({
        code: "custom",
        path: ["variants"],
        message: "Every SKU and barcode must be unique within the product.",
      });
    }

    const variantNames = value.variants.map((variant) => variant.name.toLowerCase());
    if (new Set(variantNames).size !== variantNames.length) {
      context.addIssue({
        code: "custom",
        path: ["variants"],
        message: "Variant names must be unique.",
      });
    }
  });

export const setProductArchivedSchema = z.object({
  productId: z.uuid(),
  isArchived: z.boolean(),
});

export const updateProductSchema = z.object({
  productId: z.uuid(),
  name: z.string().trim().min(1, "Enter a product name.").max(160),
  description: z.string().trim().max(2000),
  categoryId: optionalUuid,
  sku,
  barcode,
  price: moneyInput,
  cost: moneyInput,
  trackInventory: z.boolean(),
  imageUrl: z
    .string()
    .trim()
    .max(2048, "Use an image URL with at most 2,048 characters.")
    .refine((value) => value === "" || /^https?:\/\//i.test(value), "Enter a full http(s) image URL."),
  isVariablePrice: z.boolean(),
  allowFractionalQuantity: z.boolean(),
  unit: z
    .string()
    .trim()
    .min(1, "Enter a unit.")
    .max(24)
    .regex(/^[A-Za-z][A-Za-z0-9 _-]*$/, "Use letters, numbers, spaces, _ or -."),
});

export const setProductAvailabilitySchema = z.object({
  productId: z.uuid(),
  storeId: z.uuid(),
  isAvailable: z.boolean(),
});

export const setProductStoreConfigurationSchema = z.object({
  productId: z.uuid(),
  storeId: z.uuid(),
  priceOverride: z
    .string()
    .trim()
    .refine((value) => value === "" || /^\d{1,8}(?:\.\d{1,2})?$/.test(value), "Enter a non-negative price with up to 2 decimals."),
  lowStockLevel: z
    .string()
    .trim()
    .refine((value) => value === "" || /^\d{1,8}(?:\.\d{1,3})?$/.test(value), "Enter a non-negative quantity with up to 3 decimals."),
});

export const createProductUnitSchema = z.object({
  productId: z.uuid(),
  unitCode: z.string().trim().min(1).max(24).regex(/^[A-Za-z][A-Za-z0-9 _-]*$/, "Use letters, numbers, spaces, _ or -."),
  unitName: z.string().trim().min(1).max(80),
  factorToBase: z.string().trim().regex(/^\d{1,8}(?:\.\d{1,3})?$/, "Use a positive exact factor with up to 3 decimals.").refine((value) => Number(value) > 0, "The factor must be greater than zero."),
  isSaleUnit: z.boolean(),
  isPurchaseUnit: z.boolean(),
});

export const createProductComponentSchema = z.object({
  productId: z.uuid(),
  componentProductId: z.uuid(),
  componentVariantId: optionalUuid,
  quantityPerComposite: z.string().trim().regex(/^\d{1,8}(?:\.\d{1,3})?$/, "Use a positive quantity with up to 3 decimals.").refine((value) => Number(value) > 0, "The quantity must be greater than zero."),
});

const optionalMoneyInput = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || /^\d{1,8}(?:\.\d{1,2})?$/.test(value),
    "Enter a non-negative amount with up to 2 decimals.",
  );

export const importCatalogCsvSchema = z.object({
  storeIds: z.array(z.uuid()).min(1, "Select at least one store.").max(100),
  rows: z
    .array(
      z.object({
        rowNumber: z.number().int().positive(),
        name: z.string().trim().min(1, "Enter a product name.").max(160),
        description: z.string().trim().max(2000),
        categoryName: z.string().trim().max(100),
        sku,
        barcode,
        price: moneyInput,
        cost: moneyInput,
        trackInventory: z.boolean(),
        unit: z
          .string()
          .trim()
          .min(1, "Enter a base unit.")
          .max(24)
          .regex(/^[A-Za-z][A-Za-z0-9 _-]*$/, "Use letters, numbers, spaces, _ or -."),
        imageUrl: z
          .string()
          .trim()
          .max(2048, "Use an image URL with at most 2,048 characters.")
          .refine((value) => value === "" || /^https?:\/\//i.test(value), "Enter a full http(s) image URL."),
        isVariablePrice: z.boolean(),
        allowFractionalQuantity: z.boolean(),
        priceOverride: optionalMoneyInput,
        lowStockLevel: z
          .string()
          .trim()
          .refine(
            (value) => value === "" || /^\d{1,8}(?:\.\d{1,3})?$/.test(value),
            "Enter a non-negative quantity with up to 3 decimals.",
          ),
      }),
    )
    .min(1, "Choose a CSV file with at least one data row.")
    .max(500, "Import at most 500 rows at a time."),
});

export const adjustInventorySchema = z.object({
  storeId: z.uuid("Select a store."),
  productId: z.uuid("Select a product."),
  variantId: optionalUuid,
  quantityDelta: z
    .string()
    .trim()
    .regex(/^-?\d{1,8}(?:\.\d{1,3})?$/, "Use a non-zero quantity with up to 3 decimals.")
    .refine((value) => Number(value) !== 0, "Quantity cannot be zero."),
  movementType: z.enum(["OPENING_STOCK", "ADJUSTMENT"]),
  reason: z.string().trim().min(2, "Enter a reason.").max(500),
  approvalRequestId: z.uuid().nullable().optional(),
});

export const generateCatalogIdentifiersSchema = z.object({
  productName: z
    .string()
    .trim()
    .min(1, "Enter a product name before generating identifiers.")
    .max(160, "Use at most 160 characters."),
});

export type CreateCategoryValues = z.infer<typeof createCategorySchema>;
export type UpdateCategoryValues = z.infer<typeof updateCategorySchema>;
export type ProductVariantValues = z.infer<typeof productVariantSchema>;
export type CreateProductValues = z.infer<typeof createProductSchema>;
export type UpdateProductValues = z.infer<typeof updateProductSchema>;
export type AdjustInventoryValues = z.infer<typeof adjustInventorySchema>;
export type SetProductStoreConfigurationValues = z.infer<typeof setProductStoreConfigurationSchema>;
export type CreateProductUnitValues = z.infer<typeof createProductUnitSchema>;
export type CreateProductComponentValues = z.infer<typeof createProductComponentSchema>;
export type ImportCatalogCsvValues = z.infer<typeof importCatalogCsvSchema>;
export type GenerateCatalogIdentifiersValues = z.infer<typeof generateCatalogIdentifiersSchema>;
