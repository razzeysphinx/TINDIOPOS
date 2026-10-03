import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { exactTimestampScopeSql } from "./historical-trigger-scope.mjs";

test("historical timestamp scope is fixed to product_units set_updated_at", () => {
  const sql = exactTimestampScopeSql({ schema: "public", table: "product_units", name: "product_units_set_updated_at", function: "private.set_updated_at()", internal: false }, "select 1;");
  assert.match(sql, /DISABLE TRIGGER product_units_set_updated_at/u);
  assert.match(sql, /ENABLE TRIGGER product_units_set_updated_at/u);
});

test("R7 trigger flow contains no broad or replication bypass", async () => {
  const source = await readFile(new URL("./historical-trigger-scope.mjs", import.meta.url), "utf8");
  for (const forbidden of ["DISABLE TRIGGER " + "ALL", "DISABLE TRIGGER " + "USER", "session_" + "replication_role", "DROP " + "TRIGGER"]) assert.equal(source.includes(forbidden), false);
});
