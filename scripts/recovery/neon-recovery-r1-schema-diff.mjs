import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { runSql } from "../lib/phase-04-postgres-docker.mjs";
import { runCommand } from "../lib/run-command.mjs";

const ROOT = process.cwd();
const AUDIT_DIR = path.join(ROOT, ".audit");

function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Could not parse ${label} JSON evidence.`);
  }
}

function queryJson(databaseUrl, sql, label) {
  return parseJson(runSql(databaseUrl, sql), label);
}

function localDatabaseUrl() {
  const result = runCommand("pnpm", ["exec", "supabase", "status", "--output", "json"], {
    cwd: ROOT,
    env: process.env,
    capture: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error("Local Supabase is unavailable. Start it before R1 schema comparison.");
  }
  const databaseUrl = parseJson(String(result.stdout), "Supabase status").DB_URL;
  assert.ok(typeof databaseUrl === "string", "Supabase status did not expose DB_URL.");
  const hostname = new URL(databaseUrl).hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(hostname), "R1 local schema evidence must target local Supabase only.");
  return databaseUrl;
}

function liveDatabaseUrl() {
  assert.equal(process.env.TINDIO_DATABASE_PROVIDER, "neon", "TINDIO_DATABASE_PROVIDER must be neon.");
  const databaseUrl = process.env.DATABASE_URL_UNPOOLED;
  assert.ok(databaseUrl, "DATABASE_URL_UNPOOLED is required.");
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  assert.ok(hostname.endsWith(".neon.tech"), "Live R1 evidence must target Neon.");
  assert.ok(!hostname.includes("-pooler"), "R1 evidence uses the direct/unpooled Neon endpoint.");
  return databaseUrl;
}

const SQL = {
  tables: `
select coalesce(jsonb_agg(jsonb_build_object('schema', t.table_schema, 'table', t.table_name) order by t.table_schema, t.table_name), '[]'::jsonb)::text
from information_schema.tables t
where t.table_schema in ('public', 'private') and t.table_type = 'BASE TABLE';`,

  columns: `
select coalesce(jsonb_agg(jsonb_build_object('schema', c.table_schema, 'table', c.table_name, 'column', c.column_name, 'ordinal', c.ordinal_position, 'dataType', c.data_type, 'udtName', c.udt_name, 'nullable', c.is_nullable, 'defaultHash', md5(coalesce(c.column_default, ''))) order by c.table_schema, c.table_name, c.ordinal_position), '[]'::jsonb)::text
from information_schema.columns c
where c.table_schema in ('public', 'private');`,

  constraints: `
select coalesce(jsonb_agg(jsonb_build_object('schema', n.nspname, 'table', cls.relname, 'name', con.conname, 'type', con.contype, 'definitionHash', md5(pg_get_constraintdef(con.oid, true))) order by n.nspname, cls.relname, con.conname), '[]'::jsonb)::text
from pg_catalog.pg_constraint con
join pg_catalog.pg_class cls on cls.oid = con.conrelid
join pg_catalog.pg_namespace n on n.oid = cls.relnamespace
where n.nspname in ('public', 'private');`,

  functions: `
select coalesce(jsonb_agg(jsonb_build_object('schema', n.nspname, 'name', p.proname, 'arguments', pg_get_function_identity_arguments(p.oid), 'securityDefiner', p.prosecdef, 'definitionHash', md5(pg_get_functiondef(p.oid)), 'usesAuthUid', pg_get_functiondef(p.oid) ~* 'auth\\.uid\\s*\\(', 'usesAuthUserId', pg_get_functiondef(p.oid) ~* 'auth\\.user_id\\s*\\(') order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::jsonb)::text
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private');`,

  functionPrivileges: `
select coalesce(
  jsonb_agg(
    jsonb_build_object(
      'schema', n.nspname,
      'name', p.proname,
      'arguments', pg_get_function_identity_arguments(p.oid),
      'grantee', case when acl.grantee = 0 then 'PUBLIC' else grantee.rolname end,
      'privilege', acl.privilege_type,
      'grantable', acl.is_grantable
    )
    order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid),
      case when acl.grantee = 0 then 'PUBLIC' else grantee.rolname end,
      acl.privilege_type
  ),
  '[]'::jsonb
)::text
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
cross join lateral pg_catalog.aclexplode(
  coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
) acl
left join pg_catalog.pg_roles grantee on grantee.oid = acl.grantee
where n.nspname in ('public', 'private');`,

  indexes: `
select coalesce(jsonb_agg(jsonb_build_object('schema', i.schemaname, 'table', i.tablename, 'name', i.indexname, 'definitionHash', md5(i.indexdef)) order by i.schemaname, i.tablename, i.indexname), '[]'::jsonb)::text
from pg_catalog.pg_indexes i
where i.schemaname in ('public', 'private');`,

  policies: `
select coalesce(jsonb_agg(jsonb_build_object('schema', p.schemaname, 'table', p.tablename, 'name', p.policyname, 'command', p.cmd, 'permissive', p.permissive, 'roles', p.roles, 'definitionHash', md5(concat_ws('|', p.cmd, p.permissive, array_to_string(p.roles, ','), coalesce(p.qual, ''), coalesce(p.with_check, ''))), 'usesAuthUid', (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) ~* 'auth\\.uid\\s*\\(', 'usesAuthUserId', (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) ~* 'auth\\.user_id\\s*\\(') order by p.schemaname, p.tablename, p.policyname), '[]'::jsonb)::text
from pg_catalog.pg_policies p
where p.schemaname in ('public', 'private');`,

  triggers: `
select coalesce(jsonb_agg(jsonb_build_object('schema', n.nspname, 'table', cls.relname, 'name', trg.tgname, 'definitionHash', md5(pg_get_triggerdef(trg.oid, true))) order by n.nspname, cls.relname, trg.tgname), '[]'::jsonb)::text
from pg_catalog.pg_trigger trg
join pg_catalog.pg_class cls on cls.oid = trg.tgrelid
join pg_catalog.pg_namespace n on n.oid = cls.relnamespace
where n.nspname in ('public', 'private') and not trg.tgisinternal;`,

  sequences: `
select coalesce(jsonb_agg(jsonb_build_object('schema', s.sequence_schema, 'name', s.sequence_name, 'dataType', s.data_type) order by s.sequence_schema, s.sequence_name), '[]'::jsonb)::text
from information_schema.sequences s
where s.sequence_schema in ('public', 'private');`,

  extensions: `
select coalesce(jsonb_agg(jsonb_build_object('name', e.extname, 'schema', n.nspname, 'version', e.extversion) order by e.extname), '[]'::jsonb)::text
from pg_catalog.pg_extension e
join pg_catalog.pg_namespace n on n.oid = e.extnamespace;`,
};

function captureManifest(databaseUrl, label) {
  return Object.fromEntries(Object.entries(SQL).map(([key, sql]) => [key, queryJson(databaseUrl, sql, `${label}:${key}`)]));
}

function stableKey(category, value) {
  switch (category) {
    case "tables": return `${value.schema}.${value.table}`;
    case "columns": return `${value.schema}.${value.table}.${value.column}`;
    case "constraints": return `${value.schema}.${value.table}.${value.name}`;
    case "functions": return `${value.schema}.${value.name}(${value.arguments})`;
    case "functionPrivileges": return [value.schema, `${value.name}(${value.arguments})`, value.grantee, value.privilege].join("|");
    case "indexes": return `${value.schema}.${value.table}.${value.name}`;
    case "policies": return `${value.schema}.${value.table}.${value.name}`;
    case "triggers": return `${value.schema}.${value.table}.${value.name}`;
    case "sequences": return `${value.schema}.${value.name}`;
    case "extensions": return value.name;
    default: throw new Error(`Unknown manifest category: ${category}`);
  }
}

function comparableHash(category, value) {
  switch (category) {
    case "tables": return "present";
    case "columns": return JSON.stringify({ ordinal: value.ordinal, dataType: value.dataType, udtName: value.udtName, nullable: value.nullable, defaultHash: value.defaultHash });
    case "constraints":
    case "indexes":
    case "policies":
    case "triggers": return value.definitionHash;
    case "functions": return JSON.stringify({ securityDefiner: value.securityDefiner, definitionHash: value.definitionHash });
    case "functionPrivileges": return JSON.stringify({ grantable: value.grantable });
    case "sequences": return value.dataType;
    case "extensions": return JSON.stringify({ schema: value.schema, version: value.version });
    default: throw new Error(`Unknown manifest category: ${category}`);
  }
}

function diffCategory(category, localItems, liveItems) {
  const localMap = new Map(localItems.map((value) => [stableKey(category, value), value]));
  const liveMap = new Map(liveItems.map((value) => [stableKey(category, value), value]));
  const missingInLive = [];
  const liveOnly = [];
  const mismatched = [];
  for (const [key, localValue] of localMap) {
    const liveValue = liveMap.get(key);
    if (!liveValue) missingInLive.push(key);
    else if (comparableHash(category, localValue) !== comparableHash(category, liveValue)) mismatched.push(key);
  }
  for (const key of liveMap.keys()) if (!localMap.has(key)) liveOnly.push(key);
  return { localCount: localItems.length, liveCount: liveItems.length, missingInLive: missingInLive.sort(), liveOnly: liveOnly.sort(), mismatched: mismatched.sort() };
}

await mkdir(AUDIT_DIR, { recursive: true });
const localManifest = captureManifest(localDatabaseUrl(), "local");
const liveManifest = captureManifest(liveDatabaseUrl(), "live");
const categories = Object.keys(SQL);
const diff = Object.fromEntries(categories.map((category) => [category, diffCategory(category, localManifest[category], liveManifest[category])]));
const functionKeys = (manifest, field) => manifest.functions.filter((item) => item[field]).map((item) => stableKey("functions", item)).sort();
const policyKeys = (manifest) => manifest.policies.filter((item) => item.usesAuthUid || item.usesAuthUserId).map((item) => stableKey("policies", item)).sort();
const providerCoupling = {
  local: { authUidFunctions: functionKeys(localManifest, "usesAuthUid"), authUserIdFunctions: functionKeys(localManifest, "usesAuthUserId"), providerPolicies: policyKeys(localManifest) },
  live: { authUidFunctions: functionKeys(liveManifest, "usesAuthUid"), authUserIdFunctions: functionKeys(liveManifest, "usesAuthUserId"), providerPolicies: policyKeys(liveManifest) },
};
const report = {
  generatedAt: new Date().toISOString(),
  invariant: "READ_ONLY_SCHEMA_COMPARISON",
  local: { target: "LOCAL_SUPABASE_REBUILT_FROM_MIGRATIONS", counts: Object.fromEntries(categories.map((category) => [category, localManifest[category].length])) },
  live: { target: "LIVE_NEON_DIRECT_UNPOOLED", counts: Object.fromEntries(categories.map((category) => [category, liveManifest[category].length])) },
  providerCoupling,
  diff,
};
await Promise.all([
  writeFile(path.join(AUDIT_DIR, "r1-local-manifest.json"), `${JSON.stringify(localManifest, null, 2)}\n`, "utf8"),
  writeFile(path.join(AUDIT_DIR, "r1-live-manifest.json"), `${JSON.stringify(liveManifest, null, 2)}\n`, "utf8"),
  writeFile(path.join(AUDIT_DIR, "r1-schema-diff.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8"),
]);

function markdownList(values) { return values.length === 0 ? "- NONE" : values.map((value) => `- ${value}`).join("\n"); }
const markdown = ["# TINDIO Neon Recovery R1 — Schema Drift Report", "", "This report is generated from read-only schema metadata.", "", "## Targets", "", "```text", "LOCAL = clean local Supabase database rebuilt from the complete historical migration set", "LIVE  = current authoritative Neon direct/unpooled database", "```", ""];
for (const category of categories) {
  const value = diff[category];
  markdown.push(`## ${category}`, "", `Local count: ${value.localCount}`, "", `Live count: ${value.liveCount}`, "", "### Missing in live Neon", "", markdownList(value.missingInLive), "", "### Live-only", "", markdownList(value.liveOnly), "", "### Same object name but different definition", "", markdownList(value.mismatched), "");
}
markdown.push("## Provider coupling", "", "### Live functions using auth.uid()", "", markdownList(providerCoupling.live.authUidFunctions), "", "### Live functions using auth.user_id()", "", markdownList(providerCoupling.live.authUserIdFunctions), "", "### Live provider-coupled policies", "", markdownList(providerCoupling.live.providerPolicies), "", "## R1 rule", "", "This report is evidence only.", "", "Do not apply schema changes from this report automatically.", "");
await writeFile(path.join(AUDIT_DIR, "r1-schema-diff.md"), `${markdown.join("\n")}\n`, "utf8");

console.log("TINDIO NEON RECOVERY R1 SCHEMA DIFF: PASS");
console.log(JSON.stringify({
  localCounts: report.local.counts,
  liveCounts: report.live.counts,
  driftCounts: Object.fromEntries(categories.map((category) => [category, { missingInLive: diff[category].missingInLive.length, liveOnly: diff[category].liveOnly.length, mismatched: diff[category].mismatched.length }])),
  liveProviderCoupling: { authUidFunctions: providerCoupling.live.authUidFunctions.length, authUserIdFunctions: providerCoupling.live.authUserIdFunctions.length, providerPolicies: providerCoupling.live.providerPolicies.length },
  artifacts: [".audit/r1-local-manifest.json", ".audit/r1-live-manifest.json", ".audit/r1-schema-diff.json", ".audit/r1-schema-diff.md"],
}, null, 2));
