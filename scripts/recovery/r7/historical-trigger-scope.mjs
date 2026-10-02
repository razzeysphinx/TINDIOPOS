import assert from "node:assert/strict";

import { runReadOnlySql } from "../../lib/phase-04-postgres-docker.mjs";

export const HISTORICAL_IMPORT_TRIGGER_ALLOWLIST = Object.freeze([
  Object.freeze({ schema: "public", table: "product_units", functionSignature: "private.set_updated_at()", purpose: "Preserve historical updated_at during recovery import" }),
]);

export function resolveProductUnitTimestampTrigger(targetUrl) {
  const rows = JSON.parse(runReadOnlySql(targetUrl, `select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'internal',t.tgisinternal,'function',p.oid::regprocedure::text,'definition',pg_get_triggerdef(t.oid,true)) order by t.tgname),'[]'::jsonb)::text from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid where n.nspname='public' and c.relname='product_units' and p.oid::regprocedure::text='private.set_updated_at()';`));
  assert.equal(rows.length, 1, "Exactly one product_units timestamp trigger is required.");
  const trigger = rows[0];
  const allowed = HISTORICAL_IMPORT_TRIGGER_ALLOWLIST[0];
  assert.equal(trigger.schema, allowed.schema); assert.equal(trigger.table, allowed.table);
  assert.equal(trigger.function, allowed.functionSignature);
  assert.equal(trigger.internal, false, "Timestamp trigger must be non-internal.");
  assert.equal(trigger.enabled, "O", "Timestamp trigger must start enabled.");
  assert.match(trigger.name, /^[a-z][a-z0-9_]*$/u, "Unsafe trigger identifier.");
  return trigger;
}

export function exactTimestampScopeSql(trigger, reconciliationSql) {
  assert.equal(trigger.schema, "public"); assert.equal(trigger.table, "product_units");
  assert.equal(trigger.function, "private.set_updated_at()"); assert.equal(trigger.internal, false);
  assert.match(trigger.name, /^[a-z][a-z0-9_]*$/u);
  return `
    ALTER TABLE public.product_units DISABLE TRIGGER ${trigger.name};
    ${reconciliationSql}
    ALTER TABLE public.product_units ENABLE TRIGGER ${trigger.name};
    DO $verify$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='public' AND c.relname='product_units' AND t.tgname='${trigger.name}' AND NOT t.tgisinternal AND t.tgenabled='O' AND p.oid::regprocedure::text='private.set_updated_at()') THEN
        RAISE EXCEPTION 'R7 product_units timestamp trigger restoration failed';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.oid='public.product_units'::regclass AND t.tgname='product_units_protect_identity' AND t.tgenabled='O') THEN
        RAISE EXCEPTION 'R7 base-unit protection is not enabled';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.oid='public.product_units'::regclass AND t.tgname='phase16_organization_operational_guard' AND t.tgenabled='O') THEN
        RAISE EXCEPTION 'R7 organization operational guard is not enabled';
      END IF;
    END
    $verify$;
  `;
}
