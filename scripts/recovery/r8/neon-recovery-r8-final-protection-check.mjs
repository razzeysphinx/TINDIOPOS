import assert from "node:assert/strict";

import { runReadOnlySql } from "../../lib/phase-04-postgres-docker.mjs";
import { targetUrl } from "../r7/common.mjs";
import { writeR8Evidence } from "./common.mjs";

const target = targetUrl();
const protections = JSON.parse(runReadOnlySql(target, `select jsonb_build_object(
  'operationalGuards',(select count(*) from pg_trigger where tgname='phase16_organization_operational_guard' and tgenabled='O'),
  'productUnitsSetUpdatedAt',(select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_proc p on p.oid=t.tgfoid where c.oid='public.product_units'::regclass and p.oid::regprocedure::text='private.set_updated_at()' and t.tgenabled='O' and not t.tgisinternal),
  'productUnitsProtectIdentity',(select count(*) from pg_trigger where tgrelid='public.product_units'::regclass and tgname='product_units_protect_identity' and tgenabled='O'),
  'unexpectedUnvalidatedForeignKeys',(select count(*) from pg_constraint where contype='f' and not convalidated),
  'publicTablesWithoutRls',(select coalesce(jsonb_agg(c.relname order by c.relname),'[]'::jsonb) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity),
  'providerPolicies',(select count(*) from pg_policies where roles && array['anon','authenticated','service_role']::name[] or coalesce(qual,'') ~ 'auth\\.(uid|role|jwt)' or coalesce(with_check,'') ~ 'auth\\.(uid|role|jwt)'),
  'crossTenantStores',(select count(*) from public.stores s where not exists(select 1 from public.organizations o where o.id=s.organization_id)),
  'crossTenantInventory',(select count(*) from public.inventory_levels i join public.stores s on s.id=i.store_id join public.products p on p.id=i.product_id where i.organization_id<>s.organization_id or i.organization_id<>p.organization_id),
  'negativeInventory',(select count(*) from public.inventory_levels where quantity<0)
)::text;`));

assert.equal(protections.operationalGuards, 78);
assert.equal(protections.productUnitsSetUpdatedAt, 1);
assert.equal(protections.productUnitsProtectIdentity, 1);
assert.equal(protections.unexpectedUnvalidatedForeignKeys, 0);
assert.deepEqual(protections.publicTablesWithoutRls, []);
assert.equal(protections.providerPolicies, 0);
assert.equal(protections.crossTenantStores, 0);
assert.equal(protections.crossTenantInventory, 0);
assert.equal(protections.negativeInventory, 0);

const evidence = {
  generatedAt: new Date().toISOString(),
  status: "PASS",
  ...protections,
  rls: "PASS",
  tenantStoreIsolation: "PASS",
};
await writeR8Evidence("final-target-protections.json", evidence);
console.log(JSON.stringify(evidence, null, 2));
console.log("TINDIO R8 FINAL TARGET PROTECTIONS: PASS");
