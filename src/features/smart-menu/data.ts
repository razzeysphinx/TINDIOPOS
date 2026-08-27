import "server-only";

import type {
  SmartMenuConfiguration,
  SmartMenuWorkspace,
} from "@/features/smart-menu/smart-menu-types";
import type { BusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export async function loadSmartMenuWorkspace(
  context: BusinessContext,
): Promise<SmartMenuWorkspace> {
  const supabase = await createClient();
  const organizationId = context.organization.id;

  const [storesResult, categoriesResult, productsResult, menusResult, menuCategoriesResult, menuProductsResult] =
    await Promise.all([
      supabase
        .from("stores")
        .select("id, name")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("created_at", { ascending: true }),
      supabase
        .from("categories")
        .select("id, name")
        .eq("organization_id", organizationId)
        .eq("is_archived", false)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("products")
        .select("id, category_id, name, image_url")
        .eq("organization_id", organizationId)
        .eq("status", "active")
        .eq("is_composite", false)
        .not("category_id", "is", null)
        .order("name", { ascending: true }),
      supabase
        .from("smart_menus")
        .select("id, store_id, is_enabled, show_prices, show_images, show_unavailable, show_variants, show_modifiers")
        .eq("organization_id", organizationId),
      supabase
        .from("smart_menu_categories")
        .select("smart_menu_id, category_id, sort_order")
        .eq("organization_id", organizationId)
        .order("sort_order", { ascending: true }),
      supabase
        .from("smart_menu_products")
        .select("smart_menu_id, product_id, sort_order")
        .eq("organization_id", organizationId)
        .order("sort_order", { ascending: true }),
    ]);

  const baseError = [
    storesResult,
    categoriesResult,
    productsResult,
    menusResult,
    menuCategoriesResult,
    menuProductsResult,
  ].find((result) => result.error)?.error;

  if (baseError) {
    throw new Error(`Unable to load Smart Menu settings: ${baseError.message}`);
  }

  const activeCategories = categoriesResult.data ?? [];
  const activeProducts = (productsResult.data ?? []).flatMap((product) =>
    product.category_id
      ? [{
          id: product.id,
          categoryId: product.category_id,
          name: product.name,
          imageUrl: product.image_url,
        }]
      : [],
  );
  const activeCategoryIds = new Set(activeCategories.map((category) => category.id));
  const activeProductById = new Map(activeProducts.map((product) => [product.id, product]));

  const configurations: SmartMenuConfiguration[] = (menusResult.data ?? []).map((menu) => {
    const categoryIds = (menuCategoriesResult.data ?? [])
      .filter(
        (category) => category.smart_menu_id === menu.id && activeCategoryIds.has(category.category_id),
      )
      .map((category) => category.category_id);
    const selectedCategoryIds = new Set(categoryIds);

    return {
      menuId: menu.id,
      storeId: menu.store_id,
      isEnabled: menu.is_enabled,
      showPrices: menu.show_prices,
      showImages: menu.show_images,
      showUnavailable: menu.show_unavailable,
      showVariants: menu.show_variants,
      showModifiers: menu.show_modifiers,
      categoryIds,
      productIds: (menuProductsResult.data ?? [])
        .filter((product) => {
          const activeProduct = activeProductById.get(product.product_id);
          return product.smart_menu_id === menu.id
            && activeProduct !== undefined
            && selectedCategoryIds.has(activeProduct.categoryId);
        })
        .map((product) => product.product_id),
    };
  });

  return {
    stores: storesResult.data ?? [],
    categories: activeCategories,
    products: activeProducts,
    configurations,
  };
}
