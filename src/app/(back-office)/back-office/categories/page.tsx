import { Archive, Shapes } from "lucide-react";

import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CategoryArchiveButton,
  CreateCategoryForm,
} from "@/features/catalog/catalog-forms";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const context = await requireBusinessContext();
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
        description="Keep the product grid quick to scan with ordered, color-coded categories."
        action={
          <Badge variant={canManage ? "secondary" : "outline"}>
            {canManage ? "Management access" : "View access"}
          </Badge>
        }
      />

      {canManage ? <CreateCategoryForm /> : null}

      {categories.length > 0 ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {categories.map((category) => (
            <Card className={category.is_archived ? "opacity-65" : undefined} key={category.id}>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="grid size-10 shrink-0 place-items-center rounded-lg text-white"
                    style={{ backgroundColor: category.color ?? "#0f766e" }}
                  >
                    <Shapes className="size-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <CardTitle className="truncate">{category.name}</CardTitle>
                    <CardDescription className="mt-1">
                      Order {category.sort_order}
                    </CardDescription>
                  </div>
                </div>
                <Badge variant={category.is_archived ? "outline" : "secondary"}>
                  {category.is_archived ? "Archived" : "Active"}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="min-h-10 text-sm leading-5 text-muted-foreground">
                  {category.description || "No description added."}
                </p>
                {canManage ? (
                  <div className="flex justify-end border-t pt-3">
                    <CategoryArchiveButton
                      categoryId={category.id}
                      isArchived={category.is_archived}
                    />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </section>
      ) : (
        <Card>
          <CardHeader className="items-center py-10 text-center">
            <Archive className="size-8 text-muted-foreground" aria-hidden="true" />
            <CardTitle>No categories yet</CardTitle>
            <CardDescription>
              Add the first category when the organization is ready.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
