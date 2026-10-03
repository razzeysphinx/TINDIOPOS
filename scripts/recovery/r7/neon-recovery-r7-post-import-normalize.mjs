import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

import { restoreSqlAtomic, runReadOnlySql } from "../../lib/phase-04-postgres-docker.mjs";
import { sourceUrl, targetUrl } from "./common.mjs";

const phase = process.env.TINDIO_CANONICAL_MIGRATION_PHASE ?? "R7";
const directory = process.env.TINDIO_CANONICAL_MIGRATION_EVIDENCE_DIRECTORY
  ?? "docs/recovery/evidence/r7";
const remoteWriteGuard = process.env.TINDIO_CANONICAL_MIGRATION_REMOTE_WRITE_GUARD
  ?? "TINDIO_R7_REMOTE_WRITE";

assert.equal(process.env[remoteWriteGuard], "YES", `Set ${remoteWriteGuard}=YES only for isolated ${phase} post-import normalization.`);
const source = await sourceUrl();
const target = targetUrl();
const sourceRows = runReadOnlySql(source, "select coalesce(jsonb_agg(to_jsonb(t) order by organization_id,employee_id,store_id),'[]'::jsonb)::text from public.employee_stores t;");
const json = `'${sourceRows.replaceAll("'", "''")}'::jsonb`;
restoreSqlAtomic(target, `
  update public.employee_stores target set created_at=source.created_at
  from jsonb_populate_recordset(null::public.employee_stores, ${json}) source
  where target.organization_id=source.organization_id and target.employee_id=source.employee_id and target.store_id=source.store_id;
  delete from public.pos_sync_changes;
`);
const targetRows = runReadOnlySql(target, "select coalesce(jsonb_agg(to_jsonb(t) order by organization_id,employee_id,store_id),'[]'::jsonb)::text from public.employee_stores t;");
assert.equal(targetRows, sourceRows, "Employee-store historical timestamp normalization failed.");
const evidence = { generatedAt: new Date().toISOString(), table: "public.employee_stores", rowsNormalized: JSON.parse(sourceRows).length, fields: ["created_at"], triggerBypass: false, targetOnlySyncChangesCleared: true, status: "PASS" };
await writeFile(`${directory}/post-import-normalization.json`, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
console.log(`TINDIO ${phase} POST-IMPORT NORMALIZATION: PASS`);
