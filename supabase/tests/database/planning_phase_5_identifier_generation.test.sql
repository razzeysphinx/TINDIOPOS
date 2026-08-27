begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

select ok(
  to_regprocedure('public.generate_catalog_identifiers(uuid,text)') is not null,
  'catalog identifier generator exists'
);
select ok(
  has_function_privilege('authenticated', 'public.generate_catalog_identifiers(uuid,text)', 'execute'),
  'authenticated callers can reach the identifier generator'
);
select ok(
  not has_function_privilege('anon', 'public.generate_catalog_identifiers(uuid,text)', 'execute'),
  'anonymous callers cannot reach the identifier generator'
);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('55555555-5555-4555-8555-555555555551', 'identifier-owner@tindio.test', '{"full_name":"Identifier Owner"}'::jsonb),
  ('55555555-5555-4555-8555-555555555552', 'identifier-outsider@tindio.test', '{"full_name":"Identifier Outsider"}'::jsonb);

create temporary table phase5_identifier_context (
  organization_id uuid not null,
  store_id uuid not null
);
create temporary table phase5_identifiers (
  label text primary key,
  sku text not null,
  barcode text not null
);
grant select, insert, update on table phase5_identifier_context, phase5_identifiers to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555551';

insert into phase5_identifier_context (organization_id, store_id)
select organization_id, store_id
from public.bootstrap_organization(
  'Identifier Generation Retail',
  'Identifier Main',
  'Identifier Counter'
);

insert into phase5_identifiers (label, sku, barcode)
select 'first', sku, barcode
from public.generate_catalog_identifiers(
  (select organization_id from phase5_identifier_context),
  'Iced Tea 250ml'
);

insert into phase5_identifiers (label, sku, barcode)
select 'second', sku, barcode
from public.generate_catalog_identifiers(
  (select organization_id from phase5_identifier_context),
  'Iced Tea 250ml'
);

select ok(
  (select sku ~ '^TND-ICED-TEA-250ML-[A-F0-9]{8}$' from phase5_identifiers where label = 'first'),
  'generated SKU is normalized and carries a collision-resistant suffix'
);
select ok(
  (select barcode ~ '^TND-[A-F0-9]{8}$' from phase5_identifiers where label = 'first'),
  'generated barcode is Code 39-compatible'
);
select isnt(
  (select sku from phase5_identifiers where label = 'first'),
  (select sku from phase5_identifiers where label = 'second'),
  'separate generation requests receive distinct SKU candidates'
);
select isnt(
  (select barcode from phase5_identifiers where label = 'first'),
  (select barcode from phase5_identifiers where label = 'second'),
  'separate generation requests receive distinct barcode candidates'
);

select lives_ok(
  format(
    $$
      select public.create_catalog_product_v2(
        %L::uuid, null, 'Archived Identifier Item', '', 'simple', %L, %L,
        100, 0, false, 'each', array[%L::uuid], '[]'::jsonb, '', false, false
      )
    $$,
    (select organization_id from phase5_identifier_context),
    (select sku from phase5_identifiers where label = 'first'),
    (select barcode from phase5_identifiers where label = 'first'),
    (select store_id from phase5_identifier_context)
  ),
  'a generated identifier pair can be saved to the catalog'
);

update public.products
set status = 'archived'
where organization_id = (select organization_id from phase5_identifier_context)
  and sku = (select sku from phase5_identifiers where label = 'first');

select throws_ok(
  format(
    $$
      select public.create_catalog_product_v2(
        %L::uuid, null, 'Duplicate Archived Identifier Item', '', 'simple', %L, %L,
        100, 0, false, 'each', array[%L::uuid], '[]'::jsonb, '', false, false
      )
    $$,
    (select organization_id from phase5_identifier_context),
    (select sku from phase5_identifiers where label = 'first'),
    (select barcode from phase5_identifiers where label = 'first'),
    (select store_id from phase5_identifier_context)
  ),
  '23505',
  'SKU and barcode values must identify one saleable item.',
  'an archived product keeps its SKU and barcode reserved'
);

set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555552';

select throws_ok(
  format(
    $$select * from public.generate_catalog_identifiers(%L::uuid, 'Unauthorized Item')$$,
    (select organization_id from phase5_identifier_context)
  ),
  '42501',
  'Product management permission is required.',
  'a user outside the organization cannot generate identifiers'
);

set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555551';

select throws_ok(
  format(
    $$select * from public.generate_catalog_identifiers(%L::uuid, '')$$,
    (select organization_id from phase5_identifier_context)
  ),
  '22023',
  'Enter a product name between 1 and 160 characters.',
  'identifier generation rejects an empty product name'
);

select * from finish();
rollback;
