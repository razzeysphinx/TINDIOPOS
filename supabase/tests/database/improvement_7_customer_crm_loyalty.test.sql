begin;

create extension if not exists pgtap with schema extensions;

select plan(23);

select has_table('public', 'customer_segments', 'customer segments table exists');
select has_table('public', 'customer_segment_memberships', 'customer segment memberships table exists');
select is(
  (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('customer_segments', 'customer_segment_memberships')
      and relation.relrowsecurity
  ),
  2::bigint,
  'RLS is enabled on every Improvement 7 CRM table'
);
select ok(to_regprocedure('public.create_customer_segment(uuid,text,text)') is not null, 'segment creation routine exists');
select ok(to_regprocedure('public.update_customer_profile(uuid,uuid,text,text,text,text,date,text,text,uuid[])') is not null, 'customer profile routine exists');
select ok(to_regprocedure('public.adjust_customer_loyalty_points(uuid,uuid,integer,text)') is not null, 'manual loyalty adjustment routine exists');
select ok(not has_table_privilege('authenticated', 'public.customer_segments', 'insert'), 'callers cannot create segments with direct table inserts');
select ok(not has_table_privilege('authenticated', 'public.customer_segment_memberships', 'insert'), 'callers cannot assign segments with direct table inserts');

insert into auth.users (id, email, raw_user_meta_data)
values
  ('81818181-8181-4818-8818-818181818181', 'crm-owner@tindio.test', '{"full_name":"CRM Owner"}'::jsonb),
  ('82828282-8282-4828-8828-828282828282', 'crm-other@tindio.test', '{"full_name":"Other CRM Owner"}'::jsonb);

create temporary table crm_test_context (
  organization_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  customer_id uuid,
  segment_id uuid,
  manual_transaction_id uuid
);

grant select, insert, update on crm_test_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '81818181-8181-4818-8818-818181818181';

insert into crm_test_context (organization_id, store_id, register_id)
select organization_id, store_id, register_id
from public.bootstrap_organization('CRM Improvement Retail', 'CRM Improvement Main', 'CRM Improvement Counter');

with inserted_customer as (
  insert into public.customers (organization_id, full_name, phone, email)
  values (
    (select organization_id from crm_test_context),
    'CRM Test Customer',
    '09170001111',
    'crm.customer@tindio.test'
  )
  returning id
)
update crm_test_context
set customer_id = inserted_customer.id
from inserted_customer;

select is(
  (select customer_number from public.customers where id = (select customer_id from crm_test_context)),
  1::bigint,
  'a new customer receives the first organization-scoped customer ID'
);
select is(
  (select loyalty_card_code from public.customers where id = (select customer_id from crm_test_context)),
  'TND-00000001',
  'a new customer receives a scannable loyalty-card code'
);

update crm_test_context
set segment_id = public.create_customer_segment(
  organization_id,
  'VIP',
  'High-value regular customers'
);

select is(
  (select name from public.customer_segments where id = (select segment_id from crm_test_context)),
  'VIP',
  'authorized CRM user can create a customer segment'
);

select lives_ok(
  format(
    $$select public.update_customer_profile(%L, %L, 'CRM Customer Updated', 'updated@tindio.test', '09178889999', 'Manila', '1995-05-18'::date, 'Prefers morning visits', 'VIP-827', array[%L::uuid])$$,
    (select organization_id from crm_test_context),
    (select customer_id from crm_test_context),
    (select segment_id from crm_test_context)
  ),
  'authorized CRM user can update a customer profile and its segments together'
);
select is(
  (select full_name from public.customers where id = (select customer_id from crm_test_context)),
  'CRM Customer Updated',
  'profile edit updates customer contact information'
);
select is(
  (select loyalty_card_code from public.customers where id = (select customer_id from crm_test_context)),
  'VIP-827',
  'profile edit stores a supplied loyalty-card barcode'
);
select is(
  (
    select count(*)
    from public.customer_segment_memberships
    where customer_id = (select customer_id from crm_test_context)
      and segment_id = (select segment_id from crm_test_context)
  ),
  1::bigint,
  'profile edit stores the selected customer segment'
);

select public.open_register_shift(
  (select organization_id from crm_test_context),
  (select store_id from crm_test_context),
  (select register_id from crm_test_context),
  0,
  null
);

select is(
  (
    select count(*)
    from public.search_pos_customers(
      (select organization_id from crm_test_context),
      (select store_id from crm_test_context),
      'VIP-827',
      8
    )
  ),
  1::bigint,
  'assigned POS user can find a customer by loyalty-card code'
);

update crm_test_context context
set manual_transaction_id = adjustment.loyalty_transaction_id
from public.adjust_customer_loyalty_points(
  (select organization_id from crm_test_context),
  (select customer_id from crm_test_context),
  20,
  'Welcome points correction'
) adjustment;

select is(
  (
    select points_delta
    from public.loyalty_transactions
    where id = (select manual_transaction_id from crm_test_context)
  ),
  20,
  'manual loyalty adjustment is recorded as a positive immutable entry'
);
select is(
  (
    select entry_type
    from public.loyalty_transactions
    where id = (select manual_transaction_id from crm_test_context)
  ),
  'MANUAL_ADJUSTMENT',
  'manual loyalty adjustment has its own ledger entry type'
);
select is(
  (
    select coalesce(sum(points_delta), 0)
    from public.loyalty_transactions
    where customer_id = (select customer_id from crm_test_context)
  ),
  20::bigint,
  'the customer balance remains derived from the ledger'
);
select ok(
  exists (
    select 1
    from public.audit_logs audit
    where audit.organization_id = (select organization_id from crm_test_context)
      and audit.event_type = 'CUSTOMER_LOYALTY_ADJUSTED'
      and audit.actor_employee_id is not null
      and audit.metadata ->> 'loyalty_transaction_id' = (select manual_transaction_id from crm_test_context)::text
  ),
  'manual loyalty adjustment has an actor-attributed audit event'
);

create or replace function pg_temp.missing_manual_adjustment_reason_is_rejected()
returns boolean
language plpgsql
as $$
begin
  perform public.adjust_customer_loyalty_points(
    (select organization_id from crm_test_context),
    (select customer_id from crm_test_context),
    -5,
    ''
  );
  return false;
exception
  when check_violation then return true;
end;
$$;

select ok(pg_temp.missing_manual_adjustment_reason_is_rejected(), 'manual loyalty adjustment requires a reason');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '82828282-8282-4828-8828-828282828282';

select * from public.bootstrap_organization('Other CRM Improvement Retail', 'Other CRM Main', 'Other CRM Counter');

select is((select count(*) from public.customer_segments), 0::bigint, 'another organization cannot read customer segments');
select is((select count(*) from public.customer_segment_memberships), 0::bigint, 'another organization cannot read customer segment memberships');

select * from finish();
rollback;
