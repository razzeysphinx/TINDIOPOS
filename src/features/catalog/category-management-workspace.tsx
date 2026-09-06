"use client";

import { Archive, Shapes } from "lucide-react";

import { BackOfficeStateCard } from "@/components/back-office/back-office-state-card";
import { GridListViewToggle, usePersistedGridListView } from "@/components/back-office/view-toggle";
import { GuardedDeleteDialog } from "@/components/back-office/guarded-delete-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoryArchiveButton, CreateCategoryForm, EditCategoryButton } from "@/features/catalog/catalog-forms";

export type CategoryManagementItem = {
  color: string | null;
  description: string | null;
  icon: "shapes" | "cup-soda" | "utensils" | "shirt" | "smartphone" | "package";
  id: string;
  isArchived: boolean;
  name: string;
  sortOrder: number;
};

function CategoryActions({ canManage, category }: { canManage: boolean; category: CategoryManagementItem }) {
  if (!canManage) return null;

  return (
    <div className="flex flex-wrap justify-end gap-1">
      <EditCategoryButton
        category={{
          id: category.id,
          name: category.name,
          description: category.description,
          icon: category.icon,
          color: category.color,
          sortOrder: category.sortOrder,
        }}
      />
      <CategoryArchiveButton categoryId={category.id} isArchived={category.isArchived} />
      {category.isArchived ? <GuardedDeleteDialog recordId={category.id} recordName={category.name} recordType="category" /> : null}
    </div>
  );
}

function CategoryStatus({ isArchived }: { isArchived: boolean }) {
  return <Badge variant={isArchived ? "outline" : "secondary"}>{isArchived ? "Archived" : "Active"}</Badge>;
}

function CategoryIdentity({ category, compact = false }: { category: CategoryManagementItem; compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg text-white" style={{ backgroundColor: category.color ?? "#0f766e" }}>
        <Shapes className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="truncate font-medium">{category.name}</p>
        {!compact ? <p className="mt-1 truncate text-sm text-muted-foreground">{category.description || "No description added."}</p> : null}
      </div>
    </div>
  );
}

function CategoryGrid({ canManage, categories }: { canManage: boolean; categories: CategoryManagementItem[] }) {
  return (
    <section aria-label="Categories in grid view" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {categories.map((category) => (
        <Card className={category.isArchived ? "opacity-65" : undefined} key={category.id}>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg text-white" style={{ backgroundColor: category.color ?? "#0f766e" }}>
                <Shapes className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <CardTitle className="truncate">{category.name}</CardTitle>
                <CardDescription className="mt-1">Order {category.sortOrder}</CardDescription>
              </div>
            </div>
            <CategoryStatus isArchived={category.isArchived} />
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="min-h-10 text-sm leading-5 text-muted-foreground">{category.description || "No description added."}</p>
            {canManage ? <div className="border-t pt-3"><CategoryActions canManage={canManage} category={category} /></div> : null}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

function CategoryList({ canManage, categories }: { canManage: boolean; categories: CategoryManagementItem[] }) {
  return (
    <section aria-label="Categories in list view">
      <div className="grid gap-3 md:hidden">
        {categories.map((category) => (
          <article className={`rounded-xl border bg-card p-4 ${category.isArchived ? "opacity-65" : ""}`} key={category.id}>
            <div className="flex items-start justify-between gap-3"><CategoryIdentity category={category} compact /><CategoryStatus isArchived={category.isArchived} /></div>
            <p className="mt-3 text-sm leading-5 text-muted-foreground">{category.description || "No description added."}</p>
            <dl className="mt-3 flex items-center justify-between gap-3 text-sm"><div><dt className="text-muted-foreground">Order</dt><dd className="mt-1 font-medium">{category.sortOrder}</dd></div>{canManage ? <div><dt className="sr-only">Actions</dt><dd><CategoryActions canManage={canManage} category={category} /></dd></div> : null}</dl>
          </article>
        ))}
      </div>
      <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr><th className="px-4 py-3 font-medium">Category</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Order</th>{canManage ? <th className="px-4 py-3 text-right font-medium">Actions</th> : null}</tr>
          </thead>
          <tbody className="divide-y">
            {categories.map((category) => (
              <tr className={category.isArchived ? "opacity-65" : undefined} key={category.id}>
                <td className="max-w-0 px-4 py-3"><CategoryIdentity category={category} /></td>
                <td className="px-4 py-3"><CategoryStatus isArchived={category.isArchived} /></td>
                <td className="px-4 py-3 tabular-nums">{category.sortOrder}</td>
                {canManage ? <td className="px-4 py-3"><CategoryActions canManage={canManage} category={category} /></td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function CategoryManagementWorkspace({
  canManage,
  categories,
  preferenceScope,
}: {
  canManage: boolean;
  categories: CategoryManagementItem[];
  preferenceScope: string;
}) {
  const { setView, view } = usePersistedGridListView(preferenceScope, "grid");

  return (
    <section className="space-y-4" aria-label="Category management">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {canManage ? <CreateCategoryForm /> : null}
        <GridListViewToggle onChange={setView} value={view} />
      </div>

      {categories.length > 0 ? (
        view === "grid" ? <CategoryGrid canManage={canManage} categories={categories} /> : <CategoryList canManage={canManage} categories={categories} />
      ) : (
        <BackOfficeStateCard
          action={canManage ? <CreateCategoryForm /> : null}
          description="Add the first category when the organization is ready."
          icon={<Archive className="size-8 text-muted-foreground" aria-hidden="true" />}
          title="No categories yet"
        />
      )}
    </section>
  );
}
