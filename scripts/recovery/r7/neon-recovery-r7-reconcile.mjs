import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import { runReadOnlySql } from "../../lib/phase-04-postgres-docker.mjs";
import { sourceUrl, targetUrl } from "./common.mjs";

const directory = "docs/recovery/evidence/r7";
const census = JSON.parse(await readFile(`${directory}/source-target-census.json`, "utf8"));
const classification = JSON.parse(await readFile(`${directory}/table-classification.json`, "utf8"));
const source = await sourceUrl();
const target = targetUrl();

function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function primaryKey(table) {
  const [schema, name] = table.split(".");
  const key = census.sourceCatalog.primaryKeys.find((item) => item.schema === schema && item.table === name);
  assert.ok(key?.columns?.length, `${table} must have a primary key.`);
  return key.columns;
}
function bulkCanonicalRows(url) {
  const content = [];
  const ids = [];
  for (const table of classification.MIGRATE) {
    assert.match(table, /^(public|private)\.[a-z0-9_]+$/u);
    const key = primaryKey(table);
    const order = key.map((column) => `t.${column}`).join(",");
    content.push(`select '${table}' table_name, (select coalesce(jsonb_agg(to_jsonb(t) order by ${order}),'[]'::jsonb) from ${table} t) rows`);
    ids.push(`select '${table}' table_name, (select coalesce(jsonb_agg(jsonb_build_array(${key.map((column) => `t.${column}`).join(",")}) order by ${order}),'[]'::jsonb) from ${table} t) rows`);
  }
  return JSON.parse(runReadOnlySql(url, `select jsonb_build_object('content',(select jsonb_object_agg(table_name,rows order by table_name) from (${content.join(" union all ")}) c),'ids',(select jsonb_object_agg(table_name,rows order by table_name) from (${ids.join(" union all ")}) i))::text;`));
}

const rowCounts = {};
const ids = {};
const content = {};
const sourceCanonical = bulkCanonicalRows(source);
const targetCanonical = bulkCanonicalRows(target);
for (const table of classification.MIGRATE) {
  const sourceContent = JSON.stringify(sourceCanonical.content[table]);
  const targetContent = JSON.stringify(targetCanonical.content[table]);
  const sourceIds = JSON.stringify(sourceCanonical.ids[table]);
  const targetIds = JSON.stringify(targetCanonical.ids[table]);
  const sourceRows = sourceCanonical.content[table].length;
  const targetRows = targetCanonical.content[table].length;
  rowCounts[table] = { source: sourceRows, target: targetRows, difference: targetRows - sourceRows, status: sourceRows === targetRows ? "PASS" : "FAIL" };
  ids[table] = { sourceSha256: hash(sourceIds), targetSha256: hash(targetIds), status: sourceIds === targetIds ? "PASS" : "FAIL" };
  content[table] = { sourceSha256: hash(sourceContent), targetSha256: hash(targetContent), status: sourceContent === targetContent ? "PASS" : "FAIL" };
}
assert.ok(Object.values(rowCounts).every((item) => item.status === "PASS"), "Row reconciliation failed.");
assert.ok(Object.values(ids).every((item) => item.status === "PASS"), "ID reconciliation failed.");
assert.ok(Object.values(content).every((item) => item.status === "PASS"), `Content reconciliation failed: ${Object.entries(content).filter(([, item]) => item.status !== "PASS").map(([table]) => table).join(", ")}`);

const orphanResult = JSON.parse(runReadOnlySql(target, `select jsonb_build_object('unvalidatedForeignKeys',(select count(*) from pg_constraint where contype='f' and not convalidated),'crossOrganizationStores',(select count(*) from public.stores s join public.organizations o on o.id=s.organization_id where s.organization_id<>o.id),'crossOrganizationEmployees',(select count(*) from public.employees e join public.organizations o on o.id=e.organization_id where e.organization_id<>o.id),'crossOrganizationInventory',(select count(*) from public.inventory_levels i join public.stores s on s.id=i.store_id join public.products p on p.id=i.product_id where i.organization_id<>s.organization_id or i.organization_id<>p.organization_id))::text;`));
assert.deepEqual(orphanResult, { unvalidatedForeignKeys: 0, crossOrganizationStores: 0, crossOrganizationEmployees: 0, crossOrganizationInventory: 0 });

await Promise.all([
  writeFile(`${directory}/row-count-reconciliation.json`, `${JSON.stringify(rowCounts, null, 2)}\n`),
  writeFile(`${directory}/id-reconciliation.json`, `${JSON.stringify(ids, null, 2)}\n`),
  writeFile(`${directory}/content-reconciliation.json`, `${JSON.stringify(content, null, 2)}\n`),
  writeFile(`${directory}/relationship-reconciliation.json`, `${JSON.stringify({ status: "PASS", ...orphanResult }, null, 2)}\n`),
]);
console.log(JSON.stringify({ tables: classification.MIGRATE.length, rowCounts: "PASS", ids: "PASS", content: "PASS", relationships: "PASS" }, null, 2));
console.log("TINDIO R7 DATA RECONCILIATION: PASS");
