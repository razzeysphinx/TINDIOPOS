"use server";

import { revalidatePath } from "next/cache";

import type { CatalogActionResult } from "@/features/catalog/catalog-types";
import {
  createCategory,
  createProduct,
  createProductComponent,
  createProductUnit,
  deleteCatalogProduct,
  generateCatalogIdentifiers,
  importCatalogCsv,
  setCategoryArchived,
  setProductArchived,
  setProductAvailability,
  setProductStoreAvailability,
  setProductStoreConfiguration,
  updateCategory,
  updateProduct,
} from "@/features/catalog/service";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";

export async function createCategoryAction(
  input: unknown,
): Promise<CatalogActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "products.manage")) {
    return { ok: false, message: "You do not have permission to create categories." };
  }

  const result = await createCategory(context, input);

  if (result.ok) {
    revalidatePath("/back-office/categories");
    revalidatePath("/back-office/catalog");
  }

  return result;
}

export async function setCategoryArchivedAction(
  input: unknown,
): Promise<CatalogActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "products.manage")) {
    return { ok: false, message: "You do not have permission to archive categories." };
  }

  const result = await setCategoryArchived(context, input);

  if (result.ok) {
    revalidatePath("/back-office/categories");
    revalidatePath("/back-office/catalog");
  }

  return result;
}

export async function updateCategoryAction(
  input: unknown,
): Promise<CatalogActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "products.manage")) {
    return { ok: false, message: "You do not have permission to update categories." };
  }

  const result = await updateCategory(context, input);

  if (result.ok) {
    revalidatePath("/back-office/categories");
    revalidatePath("/back-office/catalog");
  }

  return result;
}

export async function createProductAction(
  input: unknown,
): Promise<CatalogActionResult<{ productId: string }>> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "products.manage")) {
    return { ok: false, message: "You do not have permission to create products." };
  }

  const result = await createProduct(context, input);

  if (result.ok) {
    revalidatePath("/back-office/catalog");
    revalidatePath("/back-office/inventory");
    revalidatePath("/back-office/replenishment");
  }

  return result;
}

export async function generateCatalogIdentifiersAction(
  input: unknown,
): Promise<CatalogActionResult<{ sku: string; barcode: string }>> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "products.manage")) {
    return { ok: false, message: "You do not have permission to generate product identifiers." };
  }

  return generateCatalogIdentifiers(context, input);
}

export async function setProductArchivedAction(
  input: unknown,
): Promise<CatalogActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "products.manage")) {
    return { ok: false, message: "You do not have permission to archive products." };
  }

  const result = await setProductArchived(context, input);

  if (result.ok) {
    revalidatePath("/back-office/catalog");
    revalidatePath("/back-office/inventory");
    revalidatePath("/back-office/replenishment");
  }

  return result;
}

export async function deleteCatalogProductAction(
  input: unknown,
): Promise<CatalogActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "products.manage")) {
    return { ok: false, message: "You do not have permission to delete products." };
  }

  const result = await deleteCatalogProduct(context, input);
  if (result.ok) {
    revalidatePath("/back-office/catalog");
    revalidatePath("/back-office/inventory");
    revalidatePath("/back-office/replenishment");
  }
  return result;
}

export async function updateProductAction(
  input: unknown,
): Promise<CatalogActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "products.manage")) {
    return { ok: false, message: "You do not have permission to update products." };
  }

  const result = await updateProduct(context, input);

  if (result.ok) {
    revalidatePath("/back-office/catalog");
    revalidatePath("/back-office/inventory");
  }

  return result;
}

export async function setProductAvailabilityAction(
  input: unknown,
): Promise<CatalogActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "products.manage")) {
    return { ok: false, message: "You do not have permission to change availability." };
  }

  const result = await setProductAvailability(context, input);

  if (result.ok) {
    revalidatePath("/back-office/catalog");
    revalidatePath("/back-office/inventory");
  }

  return result;
}

export async function setProductStoreAvailabilityAction(
  input: unknown,
): Promise<CatalogActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "products.manage")) {
    return { ok: false, message: "You do not have permission to change availability." };
  }

  const result = await setProductStoreAvailability(context, input);

  if (result.ok) {
    revalidatePath("/back-office/catalog");
    revalidatePath("/back-office/inventory");
  }

  return result;
}

export async function setProductStoreConfigurationAction(input: unknown): Promise<CatalogActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "products.manage")) {
    return { ok: false, message: "You do not have permission to configure store products." };
  }

  const result = await setProductStoreConfiguration(context, input);
  if (result.ok) {
    revalidatePath("/back-office/catalog");
    revalidatePath("/back-office/inventory");
    revalidatePath("/back-office/replenishment");
  }
  return result;
}

export async function createProductUnitAction(input: unknown): Promise<CatalogActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "products.manage")) return { ok: false, message: "You do not have permission to manage product units." };
  const result = await createProductUnit(context, input);
  if (result.ok) revalidatePath("/back-office/catalog");
  return result;
}

export async function createProductComponentAction(input: unknown): Promise<CatalogActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "products.manage")) return { ok: false, message: "You do not have permission to manage composite recipes." };
  const result = await createProductComponent(context, input);
  if (result.ok) revalidatePath("/back-office/catalog");
  return result;
}

export async function importCatalogCsvAction(
  input: unknown,
): Promise<CatalogActionResult<{ importedCount: number }>> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "products.manage")) {
    return { ok: false, message: "You do not have permission to import products." };
  }

  const result = await importCatalogCsv(context, input);

  if (result.ok) {
    revalidatePath("/back-office/catalog");
    revalidatePath("/back-office/inventory");
  }

  return result;
}
