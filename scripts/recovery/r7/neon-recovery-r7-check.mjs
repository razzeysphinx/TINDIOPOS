import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const directory = "docs/recovery/evidence/r7";
const required = ["source-target-census.json", "table-classification.json", "dependency-plan.json", "migration-result.json", "row-count-reconciliation.json", "id-reconciliation.json", "content-reconciliation.json", "relationship-reconciliation.json", "post-import-normalization.json"];
for (const file of required) await readFile(`${directory}/${file}`, "utf8");
const classification = JSON.parse(await readFile(`${directory}/table-classification.json`, "utf8"));
const migration = JSON.parse(await readFile(`${directory}/migration-result.json`, "utf8"));
assert.deepEqual(classification.INVESTIGATE, []);
assert.equal(migration.sourceWrites, 0); assert.equal(migration.failed, 0); assert.equal(migration.skipped, 0);
const scope = await readFile("scripts/recovery/r7/historical-trigger-scope.mjs", "utf8");
for (const forbidden of ["DISABLE TRIGGER " + "ALL", "DISABLE TRIGGER " + "USER", "session_" + "replication_role", "DROP " + "TRIGGER"]) assert.equal(scope.includes(forbidden), false);
assert.match(scope, /public.*product_units/u); assert.match(scope, /private\.set_updated_at\(\)/u);
console.log("TINDIO R7 AUTOMATED CONTRACT: PASS");
