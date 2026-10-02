import assert from "node:assert/strict";

import {
  assertR8CutoverAuthorized,
  readClassification,
  verifiedIdentities,
  writeR8Evidence,
} from "./common.mjs";
import {
  runReadOnlySql,
  runSql,
} from "../../lib/phase-04-postgres-docker.mjs";

function safeTableName(value) {
  assert.match(value, /^(public|private)\.[a-z0-9_]+$/u);
  return value;
}

function tableNames(url) {
  return JSON.parse(runReadOnlySql(url, `
    select coalesce(jsonb_agg(format('%I.%I', schemaname, tablename) order by schemaname, tablename), '[]'::jsonb)::text
    from pg_tables
    where schemaname in ('public', 'private');
  `));
}

function counts(url, tables) {
  const selects = tables.map((table) =>
    `select '${table}' as name, count(*)::bigint as count from ${table}`,
  );

  return JSON.parse(runReadOnlySql(url, `
    select jsonb_object_agg(name, count order by name)::text
    from (${selects.join(" union all ")}) rows;
  `));
}

assertR8CutoverAuthorized();

const classification = await readClassification();
assert.deepEqual(classification.INVESTIGATE, []);
assert.deepEqual(classification.REBUILD_DERIVED, []);
assert.deepEqual(classification.PROVIDER_OWNED_EXCLUDE, []);

const tables = [
  ...classification.MIGRATE,
  ...classification.STATIC_BOOTSTRAP_ALREADY_PRESENT,
].map(safeTableName).sort();

assert.equal(
  new Set(tables).size,
  tables.length,
  "R8 reset classification contains duplicate tables.",
);

const { target, targetIdentity } =
  await verifiedIdentities();
const targetTables = tableNames(target);
assert.deepEqual(
  targetTables,
  tables,
  "R8 reset must enumerate every public/private target table before TRUNCATE.",
);

const before = counts(target, tables);
runSql(
  target,
  `TRUNCATE TABLE ${tables.join(", ")} RESTART IDENTITY;`,
);
const after = counts(target, tables);

assert.ok(
  Object.values(after).every(
    (count) => Number(count) === 0,
  ),
  "R8 target reset did not empty every allowlisted business table.",
);

const evidence = {
  generatedAt: new Date().toISOString(),
  target: targetIdentity,
  strategy:
    "Exact classified public/private target-table TRUNCATE RESTART IDENTITY without CASCADE.",
  tableCount: tables.length,
  targetTableSetProvenExact: true,
  sourceTouched: false,
  before,
  after,
  status: "PASS",
};

await writeR8Evidence(
  "target-reset.json",
  evidence,
);

console.log(JSON.stringify(evidence, null, 2));
console.log("TINDIO R8 TARGET RESET: PASS");
