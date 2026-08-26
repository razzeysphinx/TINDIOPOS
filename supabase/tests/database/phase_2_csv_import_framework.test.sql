begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

select ok(to_regprocedure('public.import_customers_csv(uuid,jsonb)') is not null, 'customer CSV import routine exists');
select ok(to_regprocedure('public.import_suppliers_csv(uuid,jsonb)') is not null, 'supplier CSV import routine exists');
select ok(to_regprocedure('public.import_inventory_adjustments_csv(uuid,uuid,text,jsonb)') is not null, 'inventory adjustment CSV import routine exists');
select ok(has_function_privilege('authenticated', 'public.import_customers_csv(uuid,jsonb)', 'execute'), 'authenticated users can invoke customer CSV import');
select ok(not has_function_privilege('anon', 'public.import_customers_csv(uuid,jsonb)', 'execute'), 'anonymous users cannot invoke customer CSV import');
select ok(not has_function_privilege('anon', 'public.import_inventory_adjustments_csv(uuid,uuid,text,jsonb)', 'execute'), 'anonymous users cannot invoke adjustment CSV import');

insert into auth.users (id, email, raw_user_meta_data)
values ('27272727-2727-4727-8727-272727272727', 'csv-owner@tindio.test', '{"full_name":"CSV Owner"}'::jsonb);

create temporary table csv_import_context (organization_id uuid not null);
grant select, insert on csv_import_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '27272727-2727-4727-8727-272727272727';

insert into csv_import_context (organization_id)
select organization_id from public.bootstrap_organization('CSV Import Retail', 'CSV Import Main', 'CSV Import Counter');

select is(
  public.import_customers_csv(
    (select organization_id from csv_import_context),
    jsonb_build_array(jsonb_build_object('row_number', 2, 'full_name', 'Imported Customer', 'email', 'imported.customer@example.test', 'phone', '+639170000000', 'address', '', 'birthday', '', 'notes', '', 'loyalty_card_code', ''))
  ),
  1,
  'a validated customer CSV batch imports every row'
);
select is((select count(*) from public.customers where email = 'imported.customer@example.test'), 1::bigint, 'the imported customer was created');

select throws_ok(
  format(
    $$select public.import_customers_csv(%L::uuid, jsonb_build_array(jsonb_build_object('row_number', 2, 'full_name', 'Rollback customer', 'email', 'imported.customer@example.test', 'phone', '', 'address', '', 'birthday', '', 'notes', '', 'loyalty_card_code', '')));$$,
    (select organization_id from csv_import_context)
  ),
  '23505',
  'CSV row 2 matches an existing customer email. Update that customer instead.',
  'customer imports reject an existing identity rather than overwriting it'
);
select is((select count(*) from public.customers where full_name = 'Rollback customer'), 0::bigint, 'a rejected customer CSV batch leaves no partial row');

select is(
  public.import_suppliers_csv(
    (select organization_id from csv_import_context),
    jsonb_build_array(jsonb_build_object('row_number', 2, 'name', 'Imported Supplier', 'contact_name', 'Mina Cruz', 'email', 'orders@supplier.example.test', 'phone', '', 'address', '', 'notes', ''))
  ),
  1,
  'a validated supplier CSV batch imports every row'
);
select is((select count(*) from public.suppliers where name = 'Imported Supplier'), 1::bigint, 'the imported supplier was created');

select throws_ok(
  format(
    $$select public.import_suppliers_csv(%L::uuid, jsonb_build_array(jsonb_build_object('row_number', 2, 'name', 'Imported Supplier', 'contact_name', '', 'email', '', 'phone', '', 'address', '', 'notes', '')));$$,
    (select organization_id from csv_import_context)
  ),
  '23505',
  'CSV row 2 matches an existing supplier. Update that supplier instead.',
  'supplier imports reject an existing name rather than overwriting it'
);

select * from finish();
rollback;
