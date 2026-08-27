"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Archive,
  Boxes,
  Download,
  LoaderCircle,
  PackagePlus,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  Warehouse,
  WandSparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm, useWatch } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ManagerApprovalDialog } from "@/features/approvals/manager-approval-dialog";
import { requestManagerApprovalAction } from "@/features/approvals/actions";
import {
  adjustInventoryAction,
  createCategoryAction,
  createProductAction,
  createProductComponentAction,
  createProductUnitAction,
  generateCatalogIdentifiersAction,
  importCatalogCsvAction,
  setProductStoreConfigurationAction,
  setCategoryArchivedAction,
  setProductArchivedAction,
  setProductAvailabilityAction,
  updateCategoryAction,
  updateProductAction,
} from "@/features/catalog/actions";
import type { CatalogActionResult } from "@/features/catalog/catalog-types";
import {
  adjustInventorySchema,
  createCategorySchema,
  createProductSchema,
  updateCategorySchema,
  updateProductSchema,
  type AdjustInventoryValues,
  type CreateCategoryValues,
  type CreateProductValues,
  type UpdateCategoryValues,
  type UpdateProductValues,
} from "@/features/catalog/catalog-schema";
import {
  catalogCsvTemplate,
  parseCatalogCsv,
  type CatalogCsvPreviewRow,
} from "@/features/catalog/catalog-csv";

const selectClassName =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function CreateCategoryForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<CatalogActionResult<unknown> | null>(null);
  const [isPending, startTransition] = useTransition();
  const form = useForm<CreateCategoryValues>({
    resolver: zodResolver(createCategorySchema),
    defaultValues: {
      name: "",
      description: "",
      icon: "shapes",
      color: "#0F766E",
      sortOrder: 0,
    },
  });

  const submit = form.handleSubmit((values) => {
    setResult(null);
    startTransition(async () => {
      const nextResult = await createCategoryAction(values);
      setResult(nextResult);
      if (nextResult.ok) {
        form.reset();
        setOpen(false);
        router.refresh();
      }
    });
  });

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <DialogTrigger className={buttonVariants()}>
        <Plus aria-hidden="true" />
        Add category
      </DialogTrigger>
      <DialogContent size="wide">
        <DialogHeader>
          <DialogTitle>Add category</DialogTitle>
          <DialogDescription>Create an ordered, POS-ready catalogue group.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" onSubmit={submit} noValidate>
        <FormField label="Category name" error={form.formState.errors.name?.message}>
          <Input placeholder="Beverages" {...form.register("name")} />
        </FormField>
        <FormField label="Icon" error={form.formState.errors.icon?.message}>
          <select className={selectClassName} {...form.register("icon")}>
            <option value="shapes">General</option>
            <option value="cup-soda">Drinks</option>
            <option value="utensils">Food</option>
            <option value="shirt">Clothing</option>
            <option value="smartphone">Electronics</option>
            <option value="package">Goods</option>
          </select>
        </FormField>
        <FormField label="Color" error={form.formState.errors.color?.message}>
          <Input className="h-9 p-1" type="color" {...form.register("color")} />
        </FormField>
        <FormField label="Order" error={form.formState.errors.sortOrder?.message}>
          <Input
            min={0}
            type="number"
            {...form.register("sortOrder", { valueAsNumber: true })}
          />
        </FormField>
            <div className="sm:col-span-2 lg:col-span-5">
              <FormField
                label="Description"
                error={form.formState.errors.description?.message}
              >
                <Input placeholder="Optional category description" {...form.register("description")} />
              </FormField>
            </div>
            <div className="sm:col-span-2 lg:col-span-5">
              <DialogFooter>
                <Button disabled={isPending} type="submit">
                  {isPending ? <LoaderCircle className="animate-spin" /> : <Plus />}
                  Create category
                </Button>
                <ResultMessage result={result} />
              </DialogFooter>
            </div>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog.Root>
  );
}

export function EditCategoryButton({
  category,
}: {
  category: {
    id: string;
    name: string;
    description: string | null;
    icon: "shapes" | "cup-soda" | "utensils" | "shirt" | "smartphone" | "package";
    color: string | null;
    sortOrder: number;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<CatalogActionResult<unknown> | null>(null);
  const [isPending, startTransition] = useTransition();
  const form = useForm<UpdateCategoryValues>({
    resolver: zodResolver(updateCategorySchema),
    defaultValues: {
      categoryId: category.id,
      name: category.name,
      description: category.description ?? "",
      icon: category.icon,
      color: category.color ?? "#0F766E",
      sortOrder: category.sortOrder,
    },
  });

  const submit = form.handleSubmit((values) => {
    setResult(null);
    startTransition(async () => {
      const nextResult = await updateCategoryAction(values);
      setResult(nextResult);
      if (nextResult.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  });

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <DialogTrigger className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <Pencil aria-hidden="true" />
        Edit
      </DialogTrigger>
      <DialogContent size="wide">
        <DialogHeader>
          <DialogTitle>Edit category</DialogTitle>
          <DialogDescription>Update how this category appears in the catalogue and POS.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit} noValidate>
            <FormField label="Category name" error={form.formState.errors.name?.message}>
              <Input autoFocus {...form.register("name")} />
            </FormField>
            <FormField label="Icon" error={form.formState.errors.icon?.message}>
              <select className={selectClassName} {...form.register("icon")}>
                <option value="shapes">General</option>
                <option value="cup-soda">Drinks</option>
                <option value="utensils">Food</option>
                <option value="shirt">Clothing</option>
                <option value="smartphone">Electronics</option>
                <option value="package">Goods</option>
              </select>
            </FormField>
            <FormField label="Color" error={form.formState.errors.color?.message}>
              <Input className="h-9 p-1" type="color" {...form.register("color")} />
            </FormField>
            <FormField label="Order" error={form.formState.errors.sortOrder?.message}>
              <Input min={0} type="number" {...form.register("sortOrder", { valueAsNumber: true })} />
            </FormField>
            <div className="sm:col-span-2">
              <FormField label="Description" error={form.formState.errors.description?.message}>
                <Input {...form.register("description")} />
              </FormField>
            </div>
            <div className="sm:col-span-2">
              <DialogFooter>
                <Button disabled={isPending} type="submit">
                  {isPending ? <LoaderCircle className="animate-spin" /> : <Pencil />}
                  Save category
                </Button>
                <ResultMessage result={result} />
              </DialogFooter>
            </div>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog.Root>
  );
}

export function EditProductButton({
  categories,
  canTrackInventory,
  canUseWeightedProducts,
  canViewCost,
  product,
}: {
  categories: Array<{ id: string; name: string }>;
  canTrackInventory: boolean;
  canUseWeightedProducts: boolean;
  canViewCost: boolean;
  product: {
    id: string;
    name: string;
    description: string | null;
    categoryId: string | null;
    productType: "simple" | "variable" | "composite";
    sku: string | null;
    barcode: string | null;
    priceMinor: number;
    costMinor: number;
    trackInventory: boolean;
    unit: string;
    imageUrl: string | null;
    isVariablePrice: boolean;
    allowFractionalQuantity: boolean;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<CatalogActionResult<unknown> | null>(null);
  const [isPending, startTransition] = useTransition();
  const isVariable = product.productType === "variable";
  const form = useForm<UpdateProductValues>({
    resolver: zodResolver(updateProductSchema),
    defaultValues: {
      productId: product.id,
      name: product.name,
      description: product.description ?? "",
      categoryId: product.categoryId ?? "",
      sku: product.sku ?? "",
      barcode: product.barcode ?? "",
      price: minorToMoneyInput(product.priceMinor),
      cost: minorToMoneyInput(product.costMinor),
      trackInventory: product.trackInventory,
      imageUrl: product.imageUrl ?? "",
      isVariablePrice: product.isVariablePrice,
      allowFractionalQuantity: product.allowFractionalQuantity,
      unit: product.unit,
    },
  });
  const productName = useWatch({ control: form.control, name: "name" });

  const submit = form.handleSubmit((values) => {
    setResult(null);
    startTransition(async () => {
      const nextResult = await updateProductAction(values);
      setResult(nextResult);
      if (nextResult.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  });

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <DialogTrigger className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <Pencil aria-hidden="true" />
        Edit
      </DialogTrigger>
      <DialogContent size="wide">
        <DialogHeader>
          <DialogTitle>Edit product</DialogTitle>
          <DialogDescription>
            {isVariable
              ? "Edit the shared product details. Variant-specific prices and identifiers remain attached to their individual variants."
              : "Update the product details, price, identifiers, and POS behavior."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form className="space-y-5" noValidate onSubmit={submit}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FormField label="Product name" error={form.formState.errors.name?.message}>
                <Input autoFocus {...form.register("name")} />
              </FormField>
              <FormField label="Category" error={form.formState.errors.categoryId?.message}>
                <select className={selectClassName} {...form.register("categoryId")}>
                  <option value="">Uncategorized</option>
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </FormField>
              <FormField label="Unit" error={form.formState.errors.unit?.message}>
                <Input {...form.register("unit")} />
              </FormField>
            </div>
            <FormField label="Description" error={form.formState.errors.description?.message}>
              <Input {...form.register("description")} />
            </FormField>
            <FormField label="Image URL" error={form.formState.errors.imageUrl?.message}>
              <Input placeholder="https://…/product.jpg" {...form.register("imageUrl")} />
            </FormField>
            {!isVariable ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <FormField label="SKU" error={form.formState.errors.sku?.message}>
                  <Input {...form.register("sku")} />
                </FormField>
                <FormField label="Barcode" error={form.formState.errors.barcode?.message}>
                  <Input {...form.register("barcode")} />
                </FormField>
                <FormField label="Selling price" error={form.formState.errors.price?.message}>
                  <Input inputMode="decimal" {...form.register("price")} />
                </FormField>
                {canViewCost ? (
                  <FormField label="Cost" error={form.formState.errors.cost?.message}>
                    <Input inputMode="decimal" {...form.register("cost")} />
                  </FormField>
                ) : null}
                <div className="sm:col-span-2 lg:col-span-4">
                  <IdentifierGenerationButton
                    onGenerated={({ barcode, sku }) => {
                      form.setValue("sku", sku, { shouldDirty: true, shouldValidate: true });
                      form.setValue("barcode", barcode, { shouldDirty: true, shouldValidate: true });
                    }}
                    productName={productName}
                  />
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Label className="flex h-9 items-center gap-2 rounded-lg border px-3">
                <input
                  disabled={!canTrackInventory || product.productType === "composite"}
                  type="checkbox"
                  {...form.register("trackInventory")}
                />
                Track inventory{!canTrackInventory ? " (disabled)" : ""}
              </Label>
              {!isVariable ? (
                <Label className="flex h-9 items-center gap-2 rounded-lg border px-3">
                  <input type="checkbox" {...form.register("isVariablePrice")} />
                  Enter price at sale
                </Label>
              ) : null}
              <Label className="flex h-9 items-center gap-2 rounded-lg border px-3">
                <input
                  disabled={!canUseWeightedProducts}
                  type="checkbox"
                  {...form.register("allowFractionalQuantity")}
                />
                Allow fractional quantity{!canUseWeightedProducts ? " (disabled)" : ""}
              </Label>
            </div>
            <DialogFooter>
              <Button disabled={isPending} type="submit">
                {isPending ? <LoaderCircle className="animate-spin" /> : <Pencil />}
                Save product
              </Button>
              <ResultMessage result={result} />
            </DialogFooter>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog.Root>
  );
}

export function CategoryArchiveButton({
  categoryId,
  isArchived,
}: {
  categoryId: string;
  isArchived: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await setCategoryArchivedAction({ categoryId, isArchived: !isArchived });
          if (result.ok) router.refresh();
        });
      }}
      size="sm"
      variant="ghost"
    >
      {isPending ? (
        <LoaderCircle className="animate-spin" />
      ) : isArchived ? (
        <RotateCcw />
      ) : (
        <Archive />
      )}
      {isArchived ? "Restore" : "Archive"}
    </Button>
  );
}

export function CreateProductForm({
  categories,
  stores,
  canViewCost,
  canTrackInventory,
  canUseWeightedProducts,
}: {
  categories: Array<{ id: string; name: string }>;
  stores: Array<{ id: string; name: string }>;
  canViewCost: boolean;
  canTrackInventory: boolean;
  canUseWeightedProducts: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<CatalogActionResult<unknown> | null>(null);
  const [isPending, startTransition] = useTransition();
  const form = useForm<CreateProductValues>({
    resolver: zodResolver(createProductSchema),
    defaultValues: {
      name: "",
      description: "",
      categoryId: "",
      productType: "simple",
      sku: "",
      barcode: "",
      price: "0.00",
      cost: "0.00",
      trackInventory: canTrackInventory,
      imageUrl: "",
      isVariablePrice: false,
      allowFractionalQuantity: false,
      unit: "each",
      storeIds: stores[0] ? [stores[0].id] : [],
      variants: [],
    },
  });
  const { fields, append, remove, replace } = useFieldArray({
    control: form.control,
    name: "variants",
  });
  const productType = useWatch({ control: form.control, name: "productType" });
  const productName = useWatch({ control: form.control, name: "name" });
  const variantValues = useWatch({ control: form.control, name: "variants" });
  const typeRegistration = form.register("productType");
  const [barcodeSource, setBarcodeSource] = useState<"existing" | "tindio">("tindio");

  const submit = form.handleSubmit((values) => {
    setResult(null);
    startTransition(async () => {
      const nextResult = await createProductAction(values);
      setResult(nextResult);
      if (nextResult.ok) {
        form.reset();
        replace([]);
        setOpen(false);
        router.refresh();
      }
    });
  });

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <DialogTrigger className={buttonVariants()}>
        <PackagePlus aria-hidden="true" />
        Add product
      </DialogTrigger>
      <DialogContent size="large">
        <DialogHeader>
          <DialogTitle>Add product</DialogTitle>
          <DialogDescription>Create a simple item or an item with saleable variants.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form className="space-y-6" onSubmit={submit} noValidate>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label="Product name" error={form.formState.errors.name?.message}>
            <Input placeholder="House Coffee" {...form.register("name")} />
          </FormField>
          <FormField label="Category" error={form.formState.errors.categoryId?.message}>
            <select className={selectClassName} {...form.register("categoryId")}>
              <option value="">Uncategorized</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Product type" error={form.formState.errors.productType?.message}>
            <select
              className={selectClassName}
              {...typeRegistration}
              onChange={(event) => {
                typeRegistration.onChange(event);
                if (event.target.value === "variable") {
                  form.setValue("sku", "");
                  form.setValue("barcode", "");
                  if (fields.length === 0) {
                    append({ name: "", sku: "", barcode: "", price: "0.00", cost: "0.00" });
                  }
                } else {
                  replace([]);
                  if (event.target.value === "composite") {
                    form.setValue("trackInventory", true);
                  }
                }
              }}
            >
              <option value="simple">Simple product</option>
              <option value="variable">Variant product</option>
              <option value="composite">Composite product</option>
            </select>
          </FormField>
          <FormField label="Unit" error={form.formState.errors.unit?.message}>
            <Input placeholder="each" {...form.register("unit")} />
          </FormField>
        </div>

        <FormField label="Description" error={form.formState.errors.description?.message}>
          <Input placeholder="Optional product description" {...form.register("description")} />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Image URL" error={form.formState.errors.imageUrl?.message}>
            <Input placeholder="https://…/product.jpg" {...form.register("imageUrl")} />
          </FormField>
          <Label className="flex h-9 items-center gap-2 self-end rounded-lg border px-3">
            <input type="checkbox" {...form.register("isVariablePrice")} />
            Enter price at sale
          </Label>
          <Label className="flex h-9 items-center gap-2 self-end rounded-lg border px-3">
            <input
              type="checkbox"
              disabled={!canUseWeightedProducts}
              {...form.register("allowFractionalQuantity")}
            />
            Allow fractional quantity{!canUseWeightedProducts ? " (disabled)" : ""}
          </Label>
        </div>

        {productType !== "variable" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="SKU" error={form.formState.errors.sku?.message}>
              <Input placeholder="COFFEE-001" {...form.register("sku")} />
            </FormField>
            <FormField label="Barcode" error={form.formState.errors.barcode?.message}>
              <Input
                placeholder={barcodeSource === "tindio" ? "Generated TINDIO barcode" : "480000000001"}
                {...form.register("barcode")}
              />
            </FormField>
            <FormField label="Selling price" error={form.formState.errors.price?.message}>
              <Input inputMode="decimal" placeholder="0.00" {...form.register("price")} />
            </FormField>
            {canViewCost ? (
              <FormField label="Cost" error={form.formState.errors.cost?.message}>
                <Input inputMode="decimal" placeholder="0.00" {...form.register("cost")} />
              </FormField>
            ) : null}
            <fieldset className="grid gap-1.5 sm:col-span-2">
              <legend className="text-sm font-medium">Barcode source</legend>
              <div className="flex flex-wrap gap-3">
                <Label className="flex items-center gap-2 text-sm">
                  <input
                    checked={barcodeSource === "existing"}
                    name="barcode-source"
                    onChange={() => setBarcodeSource("existing")}
                    type="radio"
                  />
                  Enter existing UPC/EAN
                </Label>
                <Label className="flex items-center gap-2 text-sm">
                  <input
                    checked={barcodeSource === "tindio"}
                    name="barcode-source"
                    onChange={() => setBarcodeSource("tindio")}
                    type="radio"
                  />
                  Generate TINDIO barcode
                </Label>
              </div>
            </fieldset>
            <div className="self-end">
              <IdentifierGenerationButton
                label={barcodeSource === "tindio" ? undefined : "Auto-generate SKU"}
                onGenerated={({ barcode, sku }) => {
                  form.setValue("sku", sku, { shouldDirty: true, shouldValidate: true });
                  if (barcodeSource === "tindio") {
                    form.setValue("barcode", barcode, { shouldDirty: true, shouldValidate: true });
                  }
                }}
                productName={productName}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="font-medium">Variants</h3>
                <p className="text-xs text-muted-foreground">
                  Each variant receives its own identifier and price.
                </p>
              </div>
              <Button
                onClick={() =>
                  append({ name: "", sku: "", barcode: "", price: "0.00", cost: "0.00" })
                }
                size="sm"
                type="button"
                variant="outline"
              >
                <Plus /> Add variant
              </Button>
            </div>
            {fields.map((field, index) => (
              <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-5" key={field.id}>
                <FormField
                  label={`Variant ${index + 1}`}
                  error={form.formState.errors.variants?.[index]?.name?.message}
                >
                  <Input placeholder="Small / Black" {...form.register(`variants.${index}.name`)} />
                </FormField>
                <FormField label="SKU" error={form.formState.errors.variants?.[index]?.sku?.message}>
                  <Input placeholder="TS-S-BLK" {...form.register(`variants.${index}.sku`)} />
                  <IdentifierGenerationButton
                    compact
                    onGenerated={({ barcode, sku }) => {
                      form.setValue(`variants.${index}.sku`, sku, { shouldDirty: true, shouldValidate: true });
                      form.setValue(`variants.${index}.barcode`, barcode, { shouldDirty: true, shouldValidate: true });
                    }}
                    productName={`${productName} ${variantValues?.[index]?.name ?? ""}`}
                  />
                </FormField>
                <FormField
                  label="Barcode"
                  error={form.formState.errors.variants?.[index]?.barcode?.message}
                >
                  <Input placeholder="480000000101" {...form.register(`variants.${index}.barcode`)} />
                </FormField>
                <FormField
                  label="Selling price"
                  error={form.formState.errors.variants?.[index]?.price?.message}
                >
                  <Input inputMode="decimal" {...form.register(`variants.${index}.price`)} />
                </FormField>
                <div className="flex items-end gap-2">
                  {canViewCost ? (
                    <FormField
                      label="Cost"
                      error={form.formState.errors.variants?.[index]?.cost?.message}
                    >
                      <Input inputMode="decimal" {...form.register(`variants.${index}.cost`)} />
                    </FormField>
                  ) : null}
                  <Button
                    aria-label={`Remove variant ${index + 1}`}
                    onClick={() => remove(index)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}
            {typeof form.formState.errors.variants?.message === "string" ? (
              <p className="text-xs text-destructive">{form.formState.errors.variants.message}</p>
            ) : null}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <fieldset>
            <legend className="text-sm font-medium">Available stores</legend>
            <div className="mt-2 flex flex-wrap gap-3">
              {stores.map((store) => (
                <Label className="flex items-center gap-2 rounded-lg border px-3 py-2" key={store.id}>
                  <input type="checkbox" value={store.id} {...form.register("storeIds")} />
                  {store.name}
                </Label>
              ))}
            </div>
            <FieldError message={form.formState.errors.storeIds?.message} />
          </fieldset>
          <Label className="flex h-9 items-center gap-2 rounded-lg border px-3">
            <input
              type="checkbox"
              disabled={!canTrackInventory || productType === "composite"}
              {...form.register("trackInventory")}
            />
            Track inventory{!canTrackInventory ? " (disabled)" : ""}
          </Label>
          <Button disabled={isPending || stores.length === 0} type="submit">
            {isPending ? <LoaderCircle className="animate-spin" /> : <PackagePlus />}
            Create product
          </Button>
        </div>
            <ResultMessage result={result} />
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog.Root>
  );
}

export function ProductArchiveButton({
  productId,
  isArchived,
}: {
  productId: string;
  isArchived: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await setProductArchivedAction({ productId, isArchived: !isArchived });
          if (result.ok) router.refresh();
        });
      }}
      size="sm"
      variant="ghost"
    >
      {isPending ? <LoaderCircle className="animate-spin" /> : isArchived ? <RotateCcw /> : <Archive />}
      {isArchived ? "Restore" : "Archive"}
    </Button>
  );
}

export function CatalogExtensionForms({
  products,
  stores,
}: {
  products: Array<{ id: string; name: string; productType: string; isComposite: boolean }>;
  stores: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<CatalogActionResult<unknown> | null>(null);
  const defaultProductId = products[0]?.id ?? "";
  const [unitProductId, setUnitProductId] = useState(defaultProductId);
  const [storeProductId, setStoreProductId] = useState(defaultProductId);
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const compositeProducts = products.filter((product) => product.isComposite);
  const [compositeId, setCompositeId] = useState(compositeProducts[0]?.id ?? "");
  const [componentId, setComponentId] = useState(products.find((product) => product.id !== compositeProducts[0]?.id)?.id ?? "");

  const submit = (action: () => Promise<CatalogActionResult>) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setResult(null);
    startTransition(async () => {
      const next = await action();
      setResult(next);
      if (next.ok) router.refresh();
    });
  };

  if (products.length === 0 || stores.length === 0) return null;

  return (
    <section className="grid gap-5 xl:grid-cols-3">
      <ManagementCard title="Store pricing & stock" description="Override a simple/composite price and set a per-store low-stock threshold." icon={<Warehouse aria-hidden="true" />}>
        <form className="grid gap-3" onSubmit={submit(async () => {
          const form = new FormData(document.getElementById("store-product-settings") as HTMLFormElement);
          return setProductStoreConfigurationAction({ productId: storeProductId, storeId, priceOverride: form.get("priceOverride"), lowStockLevel: form.get("lowStockLevel") });
        })} id="store-product-settings">
          <select className={selectClassName} onChange={(event) => setStoreProductId(event.target.value)} value={storeProductId}>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select>
          <select className={selectClassName} onChange={(event) => setStoreId(event.target.value)} value={storeId}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select>
          <Input inputMode="decimal" name="priceOverride" placeholder="Store price override (optional)" />
          <Input inputMode="decimal" name="lowStockLevel" placeholder="Low-stock level (optional)" />
          <Button disabled={isPending} type="submit">{isPending ? <LoaderCircle className="animate-spin" /> : <Warehouse />} Save settings</Button>
        </form>
      </ManagementCard>

      <ManagementCard title="Units & conversions" description="Add exact sale or purchase units against the product’s deterministic base unit." icon={<Boxes aria-hidden="true" />}>
        <form className="grid gap-3" onSubmit={submit(async () => {
          const form = new FormData(document.getElementById("product-unit") as HTMLFormElement);
          return createProductUnitAction({ productId: unitProductId, unitCode: form.get("unitCode"), unitName: form.get("unitName"), factorToBase: form.get("factorToBase"), isSaleUnit: form.get("isSaleUnit") === "on", isPurchaseUnit: form.get("isPurchaseUnit") === "on" });
        })} id="product-unit">
          <select className={selectClassName} onChange={(event) => setUnitProductId(event.target.value)} value={unitProductId}>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select>
          <Input name="unitCode" placeholder="case" required />
          <Input name="unitName" placeholder="Case of 24" required />
          <Input inputMode="decimal" name="factorToBase" placeholder="Factor to base (e.g. 24)" required />
          <Label className="flex items-center gap-2 text-sm"><input defaultChecked name="isSaleUnit" type="checkbox" /> Sale unit</Label>
          <Label className="flex items-center gap-2 text-sm"><input name="isPurchaseUnit" type="checkbox" /> Purchase unit</Label>
          <Button disabled={isPending} type="submit">{isPending ? <LoaderCircle className="animate-spin" /> : <Plus />} Add unit</Button>
        </form>
      </ManagementCard>

      <ManagementCard title="Composite recipe" description="Every component is ledgered when the composite product is sold." icon={<PackagePlus aria-hidden="true" />}>
        {compositeProducts.length ? <form className="grid gap-3" onSubmit={submit(async () => {
          const form = new FormData(document.getElementById("composite-component") as HTMLFormElement);
          return createProductComponentAction({ productId: compositeId, componentProductId: componentId, componentVariantId: "", quantityPerComposite: form.get("quantityPerComposite") });
        })} id="composite-component">
          <select className={selectClassName} onChange={(event) => { setCompositeId(event.target.value); if (componentId === event.target.value) setComponentId(products.find((product) => product.id !== event.target.value)?.id ?? ""); }} value={compositeId}>{compositeProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select>
          <select className={selectClassName} onChange={(event) => setComponentId(event.target.value)} value={componentId}>{products.filter((product) => product.id !== compositeId && product.productType !== "variable").map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select>
          <Input inputMode="decimal" name="quantityPerComposite" placeholder="Component quantity (e.g. 0.025)" required />
          <Button disabled={isPending || !componentId} type="submit">{isPending ? <LoaderCircle className="animate-spin" /> : <Plus />} Add component</Button>
        </form> : <p className="text-sm text-muted-foreground">Create a composite product first, then add its recipe here.</p>}
      </ManagementCard>
      <div className="xl:col-span-3"><ResultMessage result={result} /></div>
    </section>
  );
}

export function CatalogCsvTools({
  categories,
  stores,
}: {
  categories: Array<{ id: string; name: string }>;
  stores: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<CatalogCsvPreviewRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [filename, setFilename] = useState("");
  const [selectedStoreIds, setSelectedStoreIds] = useState(() => stores.map((store) => store.id));
  const [result, setResult] = useState<CatalogActionResult<{ importedCount: number }> | null>(null);
  const [isPending, startTransition] = useTransition();

  const toggleStore = (storeId: string) => {
    setSelectedStoreIds((current) =>
      current.includes(storeId)
        ? current.filter((id) => id !== storeId)
        : [...current, storeId],
    );
  };

  const downloadTemplate = () => {
    const blob = new Blob([catalogCsvTemplate()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "tindio-catalog-import-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const chooseFile = async (file: File | undefined) => {
    setResult(null);
    setRows([]);
    setErrors([]);
    setFilename(file?.name ?? "");
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setErrors(["Choose a CSV file smaller than 1 MB."]);
      return;
    }

    const parsed = parseCatalogCsv(await file.text());
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }

    const activeCategoryNames = new Set(
      categories.map((category) => category.name.trim().toLocaleLowerCase()),
    );
    const missingCategory = parsed.rows.find(
      (row) => row.categoryName && !activeCategoryNames.has(row.categoryName.toLocaleLowerCase()),
    );
    if (missingCategory) {
      setErrors([
        `Row ${missingCategory.rowNumber}: category “${missingCategory.categoryName}” is not active. Create it first or leave the category cell blank.`,
      ]);
      return;
    }

    setRows(parsed.rows);
  };

  const importRows = () => {
    setResult(null);
    if (selectedStoreIds.length === 0) {
      setErrors(["Select at least one store for the imported products."]);
      return;
    }
    startTransition(async () => {
      const next = await importCatalogCsvAction({ storeIds: selectedStoreIds, rows });
      setResult(next);
      if (next.ok) {
        setRows([]);
        setFilename("");
        router.refresh();
      }
    });
  };

  return (
    <ManagementCard
      title="Catalog CSV"
      description="Validate a preview before one atomic import, or export the current simple-product catalogue."
      icon={<Upload aria-hidden="true" />}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="grid gap-2">
          <Label htmlFor="catalog-csv-file">Import CSV</Label>
          <Input
            accept=".csv,text/csv"
            id="catalog-csv-file"
            onChange={(event) => void chooseFile(event.target.files?.[0])}
            type="file"
          />
          <p className="text-xs text-muted-foreground">
            Simple products only; 500 rows per import. Nothing is imported until the preview is valid and you confirm.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={downloadTemplate} type="button" variant="outline">
            <Download /> Template
          </Button>
          <Button nativeButton={false} render={<a href="/api/catalog/export" />} type="button" variant="outline">
            Export catalogue
          </Button>
        </div>
      </div>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium">Make imported products available in</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {stores.map((store) => (
            <Label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" key={store.id}>
              <input
                checked={selectedStoreIds.includes(store.id)}
                onChange={() => toggleStore(store.id)}
                type="checkbox"
              />
              {store.name}
            </Label>
          ))}
        </div>
      </fieldset>

      {errors.length > 0 ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <p className="font-medium">Fix the CSV before importing.</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {errors.slice(0, 5).map((error) => <li key={error}>{error}</li>)}
          </ul>
          {errors.length > 5 ? <p className="mt-2">Plus {errors.length - 5} more error(s).</p> : null}
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-lg border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2 text-sm">
            <span>{filename || "CSV preview"}: {rows.length} valid product{rows.length === 1 ? "" : "s"}</span>
            <Button disabled={isPending} onClick={importRows} size="sm" type="button">
              {isPending ? <LoaderCircle className="animate-spin" /> : <Upload />}
              Confirm import
            </Button>
          </div>
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-background text-muted-foreground">
                <tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">Product</th><th className="px-3 py-2">Category</th><th className="px-3 py-2">Price</th><th className="px-3 py-2">Stock</th></tr>
              </thead>
              <tbody>
                {rows.slice(0, 20).map((row) => (
                  <tr className="border-t" key={row.rowNumber}>
                    <td className="px-3 py-2">{row.rowNumber}</td>
                    <td className="px-3 py-2 font-medium">{row.name}</td>
                    <td className="px-3 py-2">{row.categoryName || "—"}</td>
                    <td className="px-3 py-2">{row.price}</td>
                    <td className="px-3 py-2">{row.trackInventory ? `Tracked (${row.unit})` : "Not tracked"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 20 ? <p className="border-t px-3 py-2 text-xs text-muted-foreground">Showing the first 20 rows of the validated preview.</p> : null}
        </div>
      ) : null}
      <ResultMessage result={result} />
    </ManagementCard>
  );
}

export function ProductAvailabilityButton({
  productId,
  storeId,
  storeName,
  isAvailable,
}: {
  productId: string;
  storeId: string;
  storeName: string;
  isAvailable: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      aria-label={`${isAvailable ? "Disable" : "Enable"} ${storeName}`}
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await setProductAvailabilityAction({
            productId,
            storeId,
            isAvailable: !isAvailable,
          });
          if (result.ok) router.refresh();
        });
      }}
      size="xs"
      variant={isAvailable ? "secondary" : "outline"}
    >
      {isPending ? <LoaderCircle className="animate-spin" /> : <Warehouse />}
      {storeName}: {isAvailable ? "On" : "Off"}
    </Button>
  );
}

export type InventorySaleableItem = {
  productId: string;
  variantId: string | null;
  label: string;
  storeIds: string[];
  identifiers?: string[];
};

export function InventoryAdjustmentForm({
  stores,
  items,
}: {
  stores: Array<{ id: string; name: string }>;
  items: InventorySaleableItem[];
}) {
  const router = useRouter();
  const [result, setResult] = useState<CatalogActionResult<unknown> | null>(null);
  const [isPending, startTransition] = useTransition();
  const [approvalRequestId, setApprovalRequestId] = useState<string | null>(null);
  const initialStoreId = stores[0]?.id ?? "";
  const initialItem = items.find((item) => item.storeIds.includes(initialStoreId));
  const form = useForm<AdjustInventoryValues>({
    resolver: zodResolver(adjustInventorySchema),
    defaultValues: {
      storeId: initialStoreId,
      productId: initialItem?.productId ?? "",
      variantId: initialItem?.variantId ?? "",
      quantityDelta: "",
      movementType: "ADJUSTMENT",
      reason: "",
    },
  });
  const selectedStoreId = useWatch({ control: form.control, name: "storeId" });
  const selectedProductId = useWatch({ control: form.control, name: "productId" });
  const selectedVariantId = useWatch({ control: form.control, name: "variantId" });
  const availableItems = items.filter((item) => item.storeIds.includes(selectedStoreId));
  const itemValue = `${selectedProductId}|${selectedVariantId}`;
  const storeRegistration = form.register("storeId");

  function selectItem(value: string) {
    const [productId, variantId = ""] = value.split("|");
    form.setValue("productId", productId, { shouldValidate: true });
    form.setValue("variantId", variantId, { shouldValidate: true });
  }

  const completeAdjustment = async (
    values: AdjustInventoryValues,
    pendingApprovalRequestId: string | null,
  ) => {
    const nextResult = await adjustInventoryAction({
      ...values,
      approvalRequestId: pendingApprovalRequestId,
    });
    setResult(nextResult);
    if (nextResult.ok) {
      form.setValue("quantityDelta", "");
      form.setValue("reason", "");
      router.refresh();
    }
  };

  const submit = form.handleSubmit((values) => {
    setResult(null);
    startTransition(async () => {
      const approval = await requestManagerApprovalAction({
        operationCode: "inventory.adjust",
        reason: values.reason,
        payload: {
          store_id: values.storeId,
          product_id: values.productId,
          variant_id: values.variantId || null,
          quantity_delta: Number(values.quantityDelta),
          movement_type: values.movementType,
          reason: values.reason.trim(),
        },
      });

      if (!approval.ok) {
        setResult({ ok: false, message: approval.message });
        return;
      }

      if (approval.decision === "APPROVAL_REQUIRED") {
        setApprovalRequestId(approval.data.approvalRequestId);
        setResult({ ok: true, message: approval.message });
        return;
      }

      await completeAdjustment(values, null);
    });
  });

  if (stores.length === 0 || items.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No tracked stock yet</CardTitle>
          <CardDescription>
            Create an inventory-tracked product in an active store before recording stock.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <ManagementCard
      title="Record stock movement"
      description="Every change appends a ledger row and updates the locked projection in one transaction."
      icon={<Boxes aria-hidden="true" />}
    >
      <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-6" onSubmit={submit} noValidate>
        <FormField label="Store" error={form.formState.errors.storeId?.message}>
          <select
            className={selectClassName}
            {...storeRegistration}
            onChange={(event) => {
              storeRegistration.onChange(event);
              const firstItem = items.find((item) => item.storeIds.includes(event.target.value));
              selectItem(firstItem ? `${firstItem.productId}|${firstItem.variantId ?? ""}` : "|");
            }}
          >
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Item" error={form.formState.errors.productId?.message}>
          <select className={selectClassName} onChange={(event) => selectItem(event.target.value)} value={itemValue}>
            {availableItems.map((item) => (
              <option key={`${item.productId}|${item.variantId ?? ""}`} value={`${item.productId}|${item.variantId ?? ""}`}>
                {item.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Movement" error={form.formState.errors.movementType?.message}>
          <select className={selectClassName} {...form.register("movementType")}>
            <option value="ADJUSTMENT">Adjustment</option>
            <option value="OPENING_STOCK">Opening stock</option>
          </select>
        </FormField>
        <FormField label="Quantity change" error={form.formState.errors.quantityDelta?.message}>
          <Input inputMode="decimal" placeholder="10 or -2.5" {...form.register("quantityDelta")} />
        </FormField>
        <FormField label="Reason" error={form.formState.errors.reason?.message}>
          <Input placeholder="Initial delivery" {...form.register("reason")} />
        </FormField>
        <div className="self-end">
          <Button className="w-full" disabled={isPending || availableItems.length === 0} type="submit">
            {isPending ? <LoaderCircle className="animate-spin" /> : <Boxes />}
            Record
          </Button>
        </div>
        <div className="md:col-span-2 xl:col-span-6">
          <ResultMessage result={result} />
        </div>
      </form>
      {approvalRequestId ? (
        <ManagerApprovalDialog
          approvalRequestId={approvalRequestId}
          onApproved={() => {
            const requestId = approvalRequestId;
            setApprovalRequestId(null);
            const values = form.getValues();
            startTransition(async () => {
              await completeAdjustment(values, requestId);
            });
          }}
          onCancel={() => setApprovalRequestId(null)}
          operationLabel="Inventory adjustment"
        />
      ) : null}
    </ManagementCard>
  );
}

function ManagementCard({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary [&_svg]:size-5">
          {icon}
        </span>
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription className="mt-1">{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function IdentifierGenerationButton({
  compact = false,
  label,
  onGenerated,
  productName,
}: {
  compact?: boolean;
  label?: string;
  onGenerated: (identifiers: { sku: string; barcode: string }) => void;
  productName: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<CatalogActionResult<{ sku: string; barcode: string }> | null>(null);

  return (
    <div className={compact ? "mt-1.5" : "flex flex-wrap items-center gap-2"}>
      <Button
        disabled={isPending}
        onClick={() => {
          setResult(null);
          startTransition(async () => {
            const nextResult = await generateCatalogIdentifiersAction({ productName });
            if (nextResult.ok && nextResult.data) {
              onGenerated(nextResult.data);
            }
            setResult(nextResult);
          });
        }}
        size={compact ? "xs" : "sm"}
        type="button"
        variant="outline"
      >
        {isPending ? <LoaderCircle className="animate-spin" /> : <WandSparkles />}
        {compact ? "Auto-generate" : label ?? "Auto-generate SKU + barcode"}
      </Button>
      {result ? (
        <p
          aria-live="polite"
          className={`${compact ? "mt-1 " : ""}text-xs ${result.ok ? "text-primary" : "text-destructive"}`}
        >
          {result.message}
        </p>
      ) : null}
    </div>
  );
}

function FormField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label>{label}</Label>
      {children}
      <FieldError message={error} />
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-xs text-destructive">{message}</p> : null;
}

function minorToMoneyInput(value: number) {
  return (value / 100).toFixed(2);
}

function ResultMessage({
  result,
}: {
  result: CatalogActionResult<unknown> | null;
}) {
  return result ? (
    <p className={result.ok ? "mt-3 text-sm text-primary" : "mt-3 text-sm text-destructive"}>
      {result.message}
    </p>
  ) : null;
}
