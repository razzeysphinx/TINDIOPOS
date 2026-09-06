import { PageHeader } from "@/components/back-office/page-header";
import { CategoryManagementWorkspace } from "@/features/catalog/category-management-workspace";
import { hasPermission, requireBackOfficePermission } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const context = await requireBackOfficePermission("products.manage");
  const supabase = await createClient();
  const canManage = hasPermission(context, "products.manage");
  const { data: categories, error } = await supabase
    .from("categories")
    .select("id, name, description, icon, color, sort_order, is_archived")
    .eq("organization_id", context.organization.id)
    .order("is_archived", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Unable to load categories: ${error.message}`);
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Catalog setup"
        title="Categories"
        description="Group products so your team can find them quickly while selling."
      />

      <CategoryManagementWorkspace
        canManage={canManage}
        categories={categories.map((category) => ({
          id: category.id,
          name: category.name,
          description: category.description,
          icon: category.icon as "shapes" | "cup-soda" | "utensils" | "shirt" | "smartphone" | "package",
          color: category.color,
          sortOrder: category.sort_order,
          isArchived: category.is_archived,
        }))}
        preferenceScope={context.organization.id}
      />
    </div>
  );
}
