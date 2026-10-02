import assert from "node:assert/strict";
import test from "node:test";

import { assertOrganizationBeforeGuardedTables, buildMigrationStages } from "./dependency-planner.mjs";

test("active organization roots precede guarded historical children", () => {
  const stages = buildMigrationStages({ tables: ["public.profiles", "public.organizations", "public.permissions", "public.roles", "public.products", "public.product_units", "public.employees"], guardedTables: ["public.employees"] });
  assert.deepEqual(stages[0].tables, ["public.profiles", "public.organizations"]);
  assert.deepEqual(stages[1].tables, ["public.permissions", "public.roles"]);
  assert.deepEqual(stages[2].tables, ["public.products", "public.product_units"]);
  assert.equal(stages[3].tables.includes("public.employees"), true);
});

test("missing organization parent fails closed", () => {
  assert.throws(() => buildMigrationStages({ tables: ["public.profiles", "public.permissions", "public.roles", "public.products", "public.product_units", "public.employees"], guardedTables: ["public.employees"] }), /public\.organizations/u);
});

test("guarded child in organization stage fails closed", () => {
  assert.throws(() => assertOrganizationBeforeGuardedTables([{ id: 1, tables: ["public.organizations", "public.employees"] }], ["public.employees"]), /Unsafe R7 order/u);
});
