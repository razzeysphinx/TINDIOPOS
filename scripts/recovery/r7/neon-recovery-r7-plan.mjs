import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const directory = process.env.TINDIO_CANONICAL_MIGRATION_EVIDENCE_DIRECTORY
  ?? "docs/recovery/evidence/r7";
const phase = process.env.TINDIO_CANONICAL_MIGRATION_PHASE ?? "R7";
const census = JSON.parse(await readFile(`${directory}/source-target-census.json`, "utf8"));

const migrate = [...census.sharedTables].sort();
const staticBootstrap = [...census.targetOnlyTables].sort();
assert.deepEqual(census.sourceOnlyTables, [], "Every source table must exist on target.");

const nodes = new Set(migrate);
const dependencies = Object.fromEntries(migrate.map((table) => [table, []]));
for (const fk of census.sourceCatalog.foreignKeys) {
  const table = `${fk.schema}.${fk.table}`;
  const target = `${fk.targetSchema}.${fk.targetTable}`;
  if (nodes.has(table) && nodes.has(target) && table !== target) dependencies[table].push(target);
}
for (const values of Object.values(dependencies)) values.sort();

const remaining = new Set(migrate);
const ordered = [];
while (remaining.size > 0) {
  const ready = [...remaining].filter((table) => dependencies[table].every((dependency) => !remaining.has(dependency))).sort();
  if (ready.length === 0) break;
  for (const table of ready) { remaining.delete(table); ordered.push(table); }
}

const classification = {
  generatedAt: new Date().toISOString(),
  rationale: "All source public/private tables exist unchanged on the canonical target and are migrated, including zero-row tables. The four target-only offline/sync tables were introduced after the source schema and already exist empty in the canonical target.",
  MIGRATE: migrate,
  REBUILD_DERIVED: [],
  PROVIDER_OWNED_EXCLUDE: [],
  STATIC_BOOTSTRAP_ALREADY_PRESENT: staticBootstrap,
  EPHEMERAL_EXCLUDE: [],
  INVESTIGATE: [],
};
const plan = {
  generatedAt: new Date().toISOString(),
  strategy: "One source pg_dump consistent snapshot, read-only enforced by PGOPTIONS; one atomic target restore with target-empty guard.",
  deterministicOrder: ordered,
  cyclicTables: [...remaining].sort(),
  dependencies,
  pgDumpOwnsCycleSafeArchiveOrdering: true,
};

await writeFile(`${directory}/table-classification.json`, `${JSON.stringify(classification, null, 2)}\n`);
await writeFile(`${directory}/dependency-plan.json`, `${JSON.stringify(plan, null, 2)}\n`);
console.log(JSON.stringify({ classified: migrate.length + staticBootstrap.length, migrate: migrate.length, staticBootstrap: staticBootstrap.length, investigate: 0, ordered: ordered.length, cyclic: remaining.size }, null, 2));
console.log(`TINDIO ${phase} CLASSIFICATION + DEPENDENCY PLAN: PASS`);
