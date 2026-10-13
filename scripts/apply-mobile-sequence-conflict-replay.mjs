import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { requireCanonicalProductionNeonTarget } from "./lib/canonical-production-neon-target.mjs";
import { restoreSql, runSql } from "./lib/phase-04-postgres-docker.mjs";

assert.equal(process.env.TINDIO_DATABASE_PROVIDER, "neon", "TINDIO_DATABASE_PROVIDER must be neon.");
const { databaseUrl } = requireCanonicalProductionNeonTarget(process.env.DATABASE_URL_UNPOOLED);
const migration = await readFile(new URL("../database/migrations/0017_mobile_sequence_conflict_replay.sql", import.meta.url), "utf8");

assert.doesNotMatch(migration, /\b(?:truncate|drop\s+table|delete\s+from)\b/i);

const before = JSON.parse(runSql(databaseUrl, `select jsonb_build_object(
  'sales', (select count(*) from public.sales),
  'payments', (select count(*) from public.payments),
  'receipts', (select count(*) from public.receipts),
  'inventory_movements', (select count(*) from public.inventory_movements),
  'completed_conflicts', (
    select count(*)
    from public.pos_device_sequence_receipts receipt
    join public.offline_sync_events sync_event
      on sync_event.organization_id = receipt.organization_id
     and sync_event.device_id = receipt.device_id
     and sync_event.idempotency_key = receipt.idempotency_key
     and sync_event.local_receipt_reference = receipt.local_receipt_reference
    where receipt.state = 'CONFLICT'
      and sync_event.state = 'SYNCED'
      and (
        exists (select 1 from public.checkout_requests checkout where checkout.organization_id = receipt.organization_id and checkout.idempotency_key = receipt.idempotency_key and checkout.state = 'completed' and checkout.sale_id is not null)
        or exists (select 1 from public.advanced_checkout_requests advanced_checkout where advanced_checkout.organization_id = receipt.organization_id and advanced_checkout.idempotency_key = receipt.idempotency_key and advanced_checkout.state = 'completed' and advanced_checkout.sale_id is not null)
      )
  )
)::text;`));

restoreSql(databaseUrl, migration);

const after = JSON.parse(runSql(databaseUrl, `select jsonb_build_object(
  'sales', (select count(*) from public.sales),
  'payments', (select count(*) from public.payments),
  'receipts', (select count(*) from public.receipts),
  'inventory_movements', (select count(*) from public.inventory_movements),
  'completed_conflicts', (
    select count(*)
    from public.pos_device_sequence_receipts receipt
    join public.offline_sync_events sync_event
      on sync_event.organization_id = receipt.organization_id
     and sync_event.device_id = receipt.device_id
     and sync_event.idempotency_key = receipt.idempotency_key
     and sync_event.local_receipt_reference = receipt.local_receipt_reference
    where receipt.state = 'CONFLICT'
      and sync_event.state = 'SYNCED'
      and (
        exists (select 1 from public.checkout_requests checkout where checkout.organization_id = receipt.organization_id and checkout.idempotency_key = receipt.idempotency_key and checkout.state = 'completed' and checkout.sale_id is not null)
        or exists (select 1 from public.advanced_checkout_requests advanced_checkout where advanced_checkout.organization_id = receipt.organization_id and advanced_checkout.idempotency_key = receipt.idempotency_key and advanced_checkout.state = 'completed' and advanced_checkout.sale_id is not null)
      )
  )
)::text;`));

assert.deepEqual(
  { sales: after.sales, payments: after.payments, receipts: after.receipts, inventory_movements: after.inventory_movements },
  { sales: before.sales, payments: before.payments, receipts: before.receipts, inventory_movements: before.inventory_movements },
  "Sequence-state repair must not change financial rows.",
);
assert.equal(after.completed_conflicts, 0, "Every proven successful replay must have an APPLIED sequence receipt.");
assert.equal(runSql(databaseUrl, "select has_function_privilege('tindio_authenticated','public.finalize_pos_device_sequence(uuid,uuid,bigint,uuid,text)','execute');"), "t");
assert.equal(runSql(databaseUrl, `select count(*) from pg_proc proc cross join lateral aclexplode(coalesce(proc.proacl,acldefault('f',proc.proowner))) acl join pg_roles role on role.oid=acl.grantee where proc.oid='public.finalize_pos_device_sequence(uuid,uuid,bigint,uuid,text)'::regprocedure and role.rolname='authenticated' and acl.privilege_type='EXECUTE';`), "0");
assert.equal(runSql(databaseUrl, `select count(*) from pg_proc proc cross join lateral aclexplode(coalesce(proc.proacl,acldefault('f',proc.proowner))) acl where proc.oid='public.finalize_pos_device_sequence(uuid,uuid,bigint,uuid,text)'::regprocedure and acl.grantee=0 and acl.privilege_type='EXECUTE';`), "0");

console.log(`MOB-10 sequence replay migration: APPLIED; repaired ${before.completed_conflicts} proven stale receipt(s).`);
console.log("Financial row counts unchanged and provider-neutral grants preserved: PASS");
