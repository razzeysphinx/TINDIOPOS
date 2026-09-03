import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

const [page, workspace, forms, dialog, data, actions, exportRoute, migration] = await Promise.all([
  source("src/app/(back-office)/back-office/catalog/page.tsx"),
  source("src/features/catalog/catalog-product-workspace.tsx"),
  source("src/features/catalog/catalog-forms.tsx"),
  source("src/components/ui/dialog.tsx"),
  source("src/features/catalog/data.ts"),
  source("src/features/catalog/actions.ts"),
  source("src/app/api/catalog/export/route.ts"),
  source("supabase/migrations/20260903093657_controlled_catalog_product_delete.sql"),
]);

assert.match(page, /requireBackOfficePermission\("products\.manage"\)/, "Catalog route must retain its server permission boundary");
assert.match(page, /hasPermission\(context, "products\.view_cost"\)/, "Cost access must be derived on the server");
assert.match(page, /CatalogProductWorkspace/, "Catalog must use the product-first workspace");
assert.doesNotMatch(page, /CatalogExtensionForms/, "Advanced catalog forms must not lead the page");

assert.match(workspace, /Search products, SKU or barcode/, "Catalog must provide forgiving product search");
for (const label of ["All categories", "All statuses", "All product types", "All stores", "Name A–Z"]) assert.match(workspace, new RegExp(label));
for (const column of ["Product", "Category", "Price", "Stock", "Stores", "Status"]) assert.match(workspace, new RegExp(`>${column}<`));
assert.match(workspace, /side="right"/, "Product details must use a right-side drawer");
assert.match(workspace, /modal=\{false\}/, "The open drawer must allow another product row to update the same panel");
assert.match(workspace, /nonBlocking/, "The product drawer must keep the underlying product list interactive");
assert.match(workspace, /aria-label="Product actions"/, "Drawer utility menu must be accessible");
assert.match(workspace, /role="button" tabIndex=\{0\}/, "Desktop product rows must be keyboard accessible");
assert.match(workspace, /aria-pressed=\{isSelected\}/, "Mobile selection state must be announced");
assert.match(workspace, /canViewCost && product\.product_type/, "Cost fields must stay permission-gated");
assert.match(workspace, /Store settings/, "Store configuration must live in the selected product");
assert.match(workspace, /Selling & purchasing units/, "Units must use beginner-friendly language");
assert.match(workspace, /Components \/ Recipe/, "Composite settings must be contextual");
assert.match(workspace, /DeleteProductControl/, "Archived products must expose controlled deletion");
assert.match(workspace, /ConceptHeading/, "Advanced concepts must have accessible help");

for (const action of ["Import products", "Export catalog", "Download CSV template"]) assert.match(forms, new RegExp(action));
assert.match(forms, /<summary[^>]*>Advanced settings<\/summary>/, "The add-product flow must progressively disclose advanced settings");
assert.match(forms, /max-h-44[^\n]*overflow-y-auto/, "Large store lists must remain bounded");
assert.match(dialog, /nonBlocking/, "The shared drawer primitive must support an inspection-panel mode");

for (const relation of ["inventory_levels", "product_units", "product_components"]) assert.match(data, new RegExp(`from\\("${relation}"\\)`));
assert.match(actions, /deleteCatalogProductAction/, "Deletion must pass through a server action");
assert.match(exportRoute, /\.\.\.\(includeCosts \? \["cost"\] : \[\]\)/, "Unauthorized exports must omit the cost column entirely");
assert.match(migration, /private\.has_permission\(target_organization_id, 'products\.manage'\)/, "Delete RPC must enforce product management permission");
assert.match(migration, /existing_status <> 'archived'/, "Only archived products may be deleted");
assert.match(migration, /target_confirmation_name/, "Permanent deletion must require exact-name confirmation");
assert.match(migration, /public\.audit_logs/, "Audit history must block deletion");
assert.match(migration, /public\.product_components/, "Component use must block deletion");
assert.match(migration, /level\.quantity <> 0/, "Stock on hand must block deletion");
assert.match(migration, /when foreign_key_violation/, "All remaining business-history foreign keys must fail closed");
assert.match(migration, /revoke execute on function public\.delete_catalog_product_if_eligible/, "Delete RPC must use least-privilege execution grants");

console.log("Catalog product workspace, permission, and controlled-delete checks passed.");
