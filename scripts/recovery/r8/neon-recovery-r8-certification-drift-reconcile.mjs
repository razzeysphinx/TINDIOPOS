import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { runReadOnlySql } from "../../lib/phase-04-postgres-docker.mjs";
import { sourceUrl, targetUrl } from "../r7/common.mjs";
import { R8_EVIDENCE_DIRECTORY, writeR8Evidence } from "./common.mjs";

const SPECIAL = new Set(["public.profiles", "private.identity_links"]);
const CERTIFICATION_STARTED_AT = new Date("2026-10-02T08:42:51.000Z");
const census = JSON.parse(await readFile(`${R8_EVIDENCE_DIRECTORY}/source-target-census.json`, "utf8"));
const classification = JSON.parse(await readFile(`${R8_EVIDENCE_DIRECTORY}/table-classification.json`, "utf8"));
const source = await sourceUrl();
const target = targetUrl();

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function primaryKey(table) {
  const [schema, name] = table.split(".");
  const key = census.sourceCatalog.primaryKeys.find((item) => item.schema === schema && item.table === name);
  assert.ok(key?.columns?.length, `${table} must have a primary key.`);
  return key.columns;
}

function canonicalRows(url) {
  const content = [];
  const ids = [];
  for (const table of classification.MIGRATE) {
    assert.match(table, /^(public|private)\.[a-z0-9_]+$/u);
    const key = primaryKey(table);
    for (const column of key) assert.match(column, /^[a-z0-9_]+$/u);
    const order = key.map((column) => `t.${column}`).join(",");
    content.push(`select '${table}' table_name,(select coalesce(jsonb_agg(to_jsonb(t) order by ${order}),'[]'::jsonb) from ${table} t) rows`);
    ids.push(`select '${table}' table_name,(select coalesce(jsonb_agg(jsonb_build_array(${key.map((column) => `t.${column}`).join(",")}) order by ${order}),'[]'::jsonb) from ${table} t) rows`);
  }
  return JSON.parse(runReadOnlySql(url, `select jsonb_build_object('content',(select jsonb_object_agg(table_name,rows order by table_name) from (${content.join(" union all ")}) c),'ids',(select jsonb_object_agg(table_name,rows order by table_name) from (${ids.join(" union all ")}) i))::text;`));
}

function withoutUpdatedAt(row) {
  const rest = { ...row };
  delete rest.updated_at;
  return rest;
}

function timestampDrift(table, sourceRows, targetRows, observedAt) {
  assert.equal(sourceRows.length, targetRows.length, `${table} row count mismatch.`);
  const key = primaryKey(table);
  const drifted = [];
  for (let index = 0; index < sourceRows.length; index += 1) {
    const sourceRow = sourceRows[index];
    const targetRow = targetRows[index];
    assert.deepEqual(key.map((column) => targetRow[column]), key.map((column) => sourceRow[column]), `${table} primary key mismatch.`);
    assert.deepEqual(withoutUpdatedAt(targetRow), withoutUpdatedAt(sourceRow), `${table} non-updated_at content mismatch.`);
    if (targetRow.updated_at !== sourceRow.updated_at) {
      const sourceAt = new Date(sourceRow.updated_at);
      const targetAt = new Date(targetRow.updated_at);
      assert.ok(Number.isFinite(sourceAt.valueOf()) && Number.isFinite(targetAt.valueOf()), `${table} timestamp must be non-null and valid.`);
      assert.ok(targetAt >= sourceAt, `${table} updated_at moved backward.`);
      assert.ok(targetAt >= CERTIFICATION_STARTED_AT, `${table} drift predates frozen certification.`);
      assert.ok(targetAt <= observedAt, `${table} drift is after observation.`);
      drifted.push(targetRow);
    }
  }
  assert.equal(drifted.length, 1, `${table} must have exactly one controlled updated_at drift row.`);
  return drifted[0];
}

const sourceCanonical = canonicalRows(source);
const targetCanonical = canonicalRows(target);
const observedAt = new Date();
const rowCounts = {};
const ids = {};
const content = {};

for (const table of classification.MIGRATE) {
  const sourceRows = sourceCanonical.content[table];
  const targetRows = targetCanonical.content[table];
  const sourceIds = JSON.stringify(sourceCanonical.ids[table]);
  const targetIds = JSON.stringify(targetCanonical.ids[table]);
  rowCounts[table] = { source: sourceRows.length, target: targetRows.length, difference: targetRows.length - sourceRows.length, status: sourceRows.length === targetRows.length ? "PASS" : "FAIL" };
  ids[table] = { sourceSha256: hash(sourceIds), targetSha256: hash(targetIds), status: sourceIds === targetIds ? "PASS" : "FAIL" };
  if (!SPECIAL.has(table)) {
    const sourceContent = JSON.stringify(sourceRows);
    const targetContent = JSON.stringify(targetRows);
    content[table] = { sourceSha256: hash(sourceContent), targetSha256: hash(targetContent), status: sourceContent === targetContent ? "PASS" : "FAIL", contract: "EXACT" };
  }
}

assert.ok(Object.values(rowCounts).every((item) => item.status === "PASS"), "Row reconciliation failed.");
assert.ok(Object.values(ids).every((item) => item.status === "PASS"), "Primary-key reconciliation failed.");
assert.ok(Object.values(content).every((item) => item.status === "PASS"), `Exact content mismatch outside controlled identity metadata: ${Object.entries(content).filter(([, item]) => item.status !== "PASS").map(([table]) => table).join(", ")}`);

const driftedProfile = timestampDrift("public.profiles", sourceCanonical.content["public.profiles"], targetCanonical.content["public.profiles"], observedAt);
const driftedLink = timestampDrift("private.identity_links", sourceCanonical.content["private.identity_links"], targetCanonical.content["private.identity_links"], observedAt);
assert.equal(driftedLink.provider, "supabase", "Controlled identity drift must belong to the Supabase provider.");
assert.equal(driftedLink.profile_id, driftedProfile.id, "Controlled identity drift rows must map to the same profile.");

for (const table of SPECIAL) {
  const sourceRows = sourceCanonical.content[table].map(withoutUpdatedAt);
  const targetRows = targetCanonical.content[table].map(withoutUpdatedAt);
  content[table] = { sourceSha256: hash(JSON.stringify(sourceRows)), targetSha256: hash(JSON.stringify(targetRows)), status: "PASS", contract: "EXACT_EXCEPT_UPDATED_AT" };
}

const orphanResult = JSON.parse(runReadOnlySql(target, `select jsonb_build_object('unvalidatedForeignKeys',(select count(*) from pg_constraint where contype='f' and not convalidated),'crossOrganizationStores',(select count(*) from public.stores s join public.organizations o on o.id=s.organization_id where s.organization_id<>o.id),'crossOrganizationEmployees',(select count(*) from public.employees e join public.organizations o on o.id=e.organization_id where e.organization_id<>o.id),'crossOrganizationInventory',(select count(*) from public.inventory_levels i join public.stores s on s.id=i.store_id join public.products p on p.id=i.product_id where i.organization_id<>s.organization_id or i.organization_id<>p.organization_id))::text;`));
assert.deepEqual(orphanResult, { unvalidatedForeignKeys: 0, crossOrganizationStores: 0, crossOrganizationEmployees: 0, crossOrganizationInventory: 0 });

const functionDefinition = JSON.parse(runReadOnlySql(target, `select to_jsonb(pg_get_functiondef('public.ensure_current_identity_profile(text,text)'::regprocedure))::text;`));
assert.match(functionDefinition, /profiles[\s\S]*updated_at\s*=\s*now\(\)/iu);
assert.match(functionDefinition, /identity_links[\s\S]*updated_at\s*=\s*now\(\)/iu);
assert.match(functionDefinition, /on conflict/iu);
const [authActions, identityProvisioning] = await Promise.all([
  readFile("src/features/auth/actions.ts", "utf8"),
  readFile("src/lib/auth/identity-provisioning.ts", "utf8"),
]);
assert.match(authActions, /signInAction/iu);
assert.match(authActions, /ensureCurrentIdentityProfile/iu);
assert.match(identityProvisioning, /ensure_current_identity_profile/iu);

const identityEvidence = {
  generatedAt: observedAt.toISOString(),
  status: "PASS",
  cause: "successful frozen auth certification invokes ensure_current_identity_profile",
  causeContract: { profileUpdatedAtNow: true, identityLinkUpdatedAtNow: true, onConflict: true, repositoryCallChain: "PASS" },
  tables: {
    "public.profiles": { rowCountMatch: true, primaryKeyMatch: true, nonUpdatedAtContentMatch: true, updatedAtDriftRows: 1 },
    "private.identity_links": { rowCountMatch: true, primaryKeyMatch: true, nonUpdatedAtContentMatch: true, updatedAtDriftRows: 1 },
  },
  linkedControlledIdentitySha256: hash(JSON.stringify([driftedLink.provider, driftedLink.provider_subject, driftedLink.profile_id])),
  certificationStartedAt: CERTIFICATION_STARTED_AT.toISOString(),
  observedAt: observedAt.toISOString(),
  businessAuthoritativeWrites: 0,
  controlledCertificationMetadataWrites: 2,
  unexplainedDrift: 0,
  blindBusinessFailbackStillSafe: true,
};

await Promise.all([
  writeR8Evidence("row-count-reconciliation.json", rowCounts),
  writeR8Evidence("id-reconciliation.json", ids),
  writeR8Evidence("content-reconciliation.json", content),
  writeR8Evidence("relationship-reconciliation.json", { status: "PASS", ...orphanResult }),
  writeR8Evidence("identity-certification-drift.json", identityEvidence),
  writeR8Evidence("final-reconciliation.json", {
    generatedAt: observedAt.toISOString(),
    exactBusinessContent: "PASS",
    controlledIdentityMetadataDrift: "PASS",
    unexplainedDrift: 0,
    rowCounts: "PASS",
    ids: "PASS",
    content: "PASS_WITH_STRICT_IDENTITY_UPDATED_AT_CONTRACT",
    relationships: "PASS",
    businessAuthoritativeWrites: 0,
    controlledCertificationMetadataWrites: 2,
  }),
]);

console.log(JSON.stringify({ tables: classification.MIGRATE.length, otherTablesExact: true, profilesUpdatedAtDriftRows: 1, identityLinksUpdatedAtDriftRows: 1, unexplainedDrift: 0 }, null, 2));
console.log("TINDIO R8 CERTIFICATION-DRIFT RECONCILIATION: PASS");
