import assert from "node:assert/strict";

export const semanticDependencies = Object.freeze([
  Object.freeze({
    parent: "public.organizations",
    childrenMatching: Object.freeze({ trigger: "phase16_organization_operational_guard" }),
    reason: "The operational guard requires the organization parent to exist and be active before historical child insertion.",
  }),
]);

export function buildMigrationStages({ tables, guardedTables }) {
  const available = new Set(tables);
  for (const required of ["public.profiles", "public.organizations"]) {
    assert.ok(available.has(required), `${required} is required by the R7 root stage.`);
  }
  const roots = ["public.profiles", "public.organizations"];
  const references = ["public.permissions", "public.roles"];
  for (const required of references) assert.ok(available.has(required), `${required} is required by the R7 reference stage.`);
  const catalogRoots = ["public.products", "public.product_units"];
  for (const required of catalogRoots) assert.ok(available.has(required), `${required} is required by the R7 catalog-root stage.`);
  const finalRbac = ["public.role_permissions"];
  const remaining = tables.filter((table) => !roots.includes(table) && !references.includes(table) && !catalogRoots.includes(table) && !finalRbac.includes(table));
  const stages = [
    { id: 1, name: "organization-roots", tables: roots },
    { id: 2, name: "permission-role-references", tables: references },
    { id: 3, name: "catalog-roots", tables: catalogRoots },
    { id: 4, name: "dependency-ordered-business-data", tables: remaining },
    { id: 5, name: "authoritative-role-permissions", tables: finalRbac },
    { id: 6, name: "sequence-checkpoint-normalization", tables: [] },
  ];
  assertOrganizationBeforeGuardedTables(stages, guardedTables);
  return stages;
}

export function assertOrganizationBeforeGuardedTables(stages, guardedTables) {
  const index = new Map(stages.flatMap((stage) => stage.tables.map((table) => [table, stage.id])));
  const organizationStage = index.get("public.organizations");
  assert.ok(organizationStage != null, "Organization table missing from migration plan.");
  for (const table of guardedTables) {
    const childStage = index.get(table);
    if (childStage == null) continue;
    assert.ok(organizationStage < childStage, `Unsafe R7 order: ${table} is not after public.organizations.`);
  }
}
