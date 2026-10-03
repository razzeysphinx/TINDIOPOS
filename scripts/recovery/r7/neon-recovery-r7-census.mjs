import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

import { runReadOnlySql } from "../../lib/phase-04-postgres-docker.mjs";
import { SOURCE, TARGET, identity, quoteLiteral, sanitizedIdentity, sourceUrl, targetUrl } from "./common.mjs";

const outputDirectory = process.env.TINDIO_CANONICAL_MIGRATION_EVIDENCE_DIRECTORY
  ?? "docs/recovery/evidence/r7";
const phase = process.env.TINDIO_CANONICAL_MIGRATION_PHASE ?? "R7";

function tableNames(url) {
  return JSON.parse(runReadOnlySql(url, `
    select coalesce(jsonb_agg(format('%I.%I', schemaname, tablename) order by schemaname, tablename), '[]'::jsonb)::text
    from pg_tables where schemaname in ('public','private');
  `));
}

function counts(url, tables) {
  if (tables.length === 0) return {};
  const selects = tables.map((table) => {
    const [schema, name] = table.split(".");
    assert.match(schema, /^(public|private)$/u);
    assert.match(name, /^[a-z0-9_]+$/u);
    return `select ${quoteLiteral(table)} as table_name, count(*)::bigint as row_count from ${schema}.${name}`;
  });
  const rows = JSON.parse(runReadOnlySql(url, `
    select coalesce(jsonb_object_agg(table_name, row_count order by table_name), '{}'::jsonb)::text
    from (${selects.join(" union all ")}) census;
  `));
  return Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, Number(value)]));
}

function catalog(url) {
  return JSON.parse(runReadOnlySql(url, `
    select jsonb_build_object(
      'columns', (select coalesce(jsonb_agg(to_jsonb(c) order by table_schema, table_name, ordinal_position), '[]'::jsonb) from information_schema.columns c where table_schema in ('public','private')),
      'primaryKeys', (select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',cl.relname,'name',con.conname,'columns',(select jsonb_agg(a.attname order by key.ordinality) from unnest(con.conkey) with ordinality key(attnum, ordinality) join pg_attribute a on a.attrelid=con.conrelid and a.attnum=key.attnum)) order by n.nspname,cl.relname), '[]'::jsonb) from pg_constraint con join pg_class cl on cl.oid=con.conrelid join pg_namespace n on n.oid=cl.relnamespace where con.contype='p' and n.nspname in ('public','private')),
      'foreignKeys', (select coalesce(jsonb_agg(jsonb_build_object('schema',sn.nspname,'table',sc.relname,'name',con.conname,'targetSchema',tn.nspname,'targetTable',tc.relname,'validated',con.convalidated) order by sn.nspname,sc.relname,con.conname), '[]'::jsonb) from pg_constraint con join pg_class sc on sc.oid=con.conrelid join pg_namespace sn on sn.oid=sc.relnamespace join pg_class tc on tc.oid=con.confrelid join pg_namespace tn on tn.oid=tc.relnamespace where con.contype='f' and sn.nspname in ('public','private')),
      'sequences', (select coalesce(jsonb_agg(to_jsonb(s) order by sequence_schema,sequence_name), '[]'::jsonb) from information_schema.sequences s where sequence_schema in ('public','private'))
    )::text;
  `));
}

async function main() {
  const source = await sourceUrl();
  const target = targetUrl();
  assert.notEqual(new URL(source).hostname, new URL(target).hostname, "Source and target must differ.");
  const sourceIdentity = identity(source);
  const targetIdentity = identity(target);
  assert.equal(sourceIdentity.readOnly, true);
  assert.equal(targetIdentity.readOnly, true);
  const sourceTables = tableNames(source);
  const targetTables = tableNames(target);
  const sharedTables = sourceTables.filter((table) => targetTables.includes(table));
  const evidence = {
    generatedAt: new Date().toISOString(),
    source: sanitizedIdentity(SOURCE, sourceIdentity),
    target: sanitizedIdentity(TARGET, targetIdentity),
    sourceReadOnlyGuard: "BEGIN TRANSACTION READ ONLY + PGOPTIONS default_transaction_read_only=on",
    sourceTables,
    targetTables,
    sharedTables,
    sourceOnlyTables: sourceTables.filter((table) => !targetTables.includes(table)),
    targetOnlyTables: targetTables.filter((table) => !sourceTables.includes(table)),
    sourceCounts: counts(source, sourceTables),
    targetCounts: counts(target, targetTables),
    sourceCatalog: catalog(source),
    targetCatalog: catalog(target),
  };
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(`${outputDirectory}/source-target-census.json`, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({
    source: evidence.source,
    target: evidence.target,
    sharedTables: sharedTables.length,
    sourceOnlyTables: evidence.sourceOnlyTables,
    targetOnlyTables: evidence.targetOnlyTables,
    sourceRows: Object.values(evidence.sourceCounts).reduce((sum, count) => sum + count, 0),
    targetRows: Object.values(evidence.targetCounts).reduce((sum, count) => sum + count, 0),
  }, null, 2));
  console.log(`TINDIO ${phase} READ-ONLY SOURCE/TARGET CENSUS: PASS`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
