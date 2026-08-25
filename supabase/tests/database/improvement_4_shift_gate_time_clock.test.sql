begin;

create extension if not exists pgtap with schema extensions;

select plan(21);

select has_table('public', 'time_clock_entries', 'time clock entries table exists');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.time_clock_entries'::regclass),
  'time clock entries have RLS enabled'
);
select has_column(
  'public',
  'organizations',
  'show_expected_cash_before_close',
  'organizations can configure blind cash closing'
);
select ok(
  to_regprocedure('public.clock_in_employee(uuid,uuid,text)') is not null
  and to_regprocedure('public.clock_out_employee(uuid,text)') is not null
  and to_regprocedure('public.get_current_time_clock_entry(uuid)') is not null,
  'time-clock RPCs exist'
);
select ok(
  not has_function_privilege('anon', 'public.clock_in_employee(uuid,uuid,text)', 'execute'),
  'anonymous callers cannot clock in'
);
select ok(
  not has_table_privilege('authenticated', 'public.time_clock_entries', 'insert'),
  'employees cannot write time-clock entries directly'
);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('d4000000-0000-4000-8000-000000000001', 'phase4-owner@tindio.test', '{"full_name":"Phase 4 Owner"}'::jsonb),
  ('d4000000-0000-4000-8000-000000000002', 'phase4-cashier@tindio.test', '{"full_name":"Phase 4 Cashier"}'::jsonb);

create temporary table phase4_context (
  organization_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  shift_id uuid,
  product_id uuid,
  ticket_id uuid
);

grant select, insert, update on phase4_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = 'd4000000-0000-4000-8000-000000000001';

insert into phase4_context (organization_id, store_id, register_id)
select organization_id, store_id, register_id
from public.bootstrap_organization('Phase 4 Controls Retail', 'Phase 4 Main', 'Phase 4 Counter');

select lives_ok(
  format(
    $$select public.clock_in_employee(%L, %L, null)$$,
    (select organization_id from phase4_context),
    (select store_id from phase4_context)
  ),
  'an active assigned employee can clock in without opening a register shift'
);
select is(
  (select count(*) from public.get_current_time_clock_entry((select organization_id from phase4_context))),
  1::bigint,
  'time-clock status is available independently of shift status'
);
select lives_ok(
  format(
    $$select public.clock_out_employee(%L, null)$$,
    (select organization_id from phase4_context)
  ),
  'an employee can clock out without a register-shift transition'
);

update phase4_context
set product_id = public.create_catalog_product_v2(
  organization_id,
  null,
  'Phase 4 Gate Item',
  'A product used to verify shift-gated POS actions.',
  'simple',
  'PHASE4-GATE-ITEM',
  '480000040001',
  1000,
  0,
  false,
  'each',
  array[store_id],
  '[]'::jsonb,
  null,
  false,
  false
);

select lives_ok(
  format(
    $$select public.open_register_shift(%L, %L, %L, 10000, 'Phase 4 opening float')$$,
    (select organization_id from phase4_context),
    (select store_id from phase4_context),
    (select register_id from phase4_context)
  ),
  'owner opens the register shift used by the phase 4 checks'
);

update phase4_context
set shift_id = (
  select shift.id
  from public.shifts shift
  where shift.organization_id = phase4_context.organization_id
    and shift.status = 'open'
);

update phase4_context
set ticket_id = (
  select ticket.ticket_id
  from public.save_open_ticket(
    (select organization_id from phase4_context),
    (select store_id from phase4_context),
    (select register_id from phase4_context),
    null,
    null,
    null,
    'Phase 4 held ticket',
    null,
    jsonb_build_array(jsonb_build_object(
      'product_id', (select product_id from phase4_context),
      'variant_id', null,
      'quantity', 1,
      'unit_price_minor', null
    ))
  ) ticket
);

select ok((select ticket_id is not null from phase4_context), 'an owned open shift can save a held ticket');

reset role;
insert into public.employees (organization_id, profile_id, employee_number, job_title)
select organization_id, 'd4000000-0000-4000-8000-000000000002', 'PHASE4-CASH-002', 'Cashier'
from phase4_context;

insert into public.employee_roles (organization_id, employee_id, role_id)
select employee.organization_id, employee.id, role.id
from public.employees employee
join public.roles role
  on role.organization_id = employee.organization_id
 and role.code = 'cashier'
where employee.profile_id = 'd4000000-0000-4000-8000-000000000002';

insert into public.employee_stores (organization_id, employee_id, store_id)
select employee.organization_id, employee.id, context.store_id
from public.employees employee
join phase4_context context on context.organization_id = employee.organization_id
where employee.profile_id = 'd4000000-0000-4000-8000-000000000002';

set local role authenticated;
set local request.jwt.claim.sub = 'd4000000-0000-4000-8000-000000000002';

select throws_ok(
  format(
    $$select * from public.search_pos_customers(%L, %L, '', 8)$$,
    (select organization_id from phase4_context),
    (select store_id from phase4_context)
  ),
  '42501',
  'Open a register shift before using the POS workspace.',
  'customer lookup is blocked without an owned open shift'
);
select throws_ok(
  format(
    $$select * from public.save_open_ticket(%L, %L, %L, null, null, null, 'Blocked ticket', null, jsonb_build_array(jsonb_build_object('product_id', %L::uuid, 'variant_id', null, 'quantity', 1, 'unit_price_minor', null)))$$,
    (select organization_id from phase4_context),
    (select store_id from phase4_context),
    (select register_id from phase4_context),
    (select product_id from phase4_context)
  ),
  '42501',
  'Open your register shift before using transactional POS features.',
  'held tickets are blocked without an owned open shift'
);
select throws_ok(
  format(
    $$select public.cancel_open_ticket(%L, %L)$$,
    (select organization_id from phase4_context),
    (select ticket_id from phase4_context)
  ),
  '42501',
  'Open your register shift before using transactional POS features.',
  'held tickets cannot be cancelled without the active drawer owner'
);
select throws_ok(
  format(
    $$select * from public.checkout_advanced_sale(%L, %L, %L, 'd4000000-0000-4000-8000-000000000010', jsonb_build_array(jsonb_build_object('product_id', %L::uuid, 'variant_id', null, 'quantity', 1)), jsonb_build_array(jsonb_build_object('payment_method_id', (select id from public.payment_methods where organization_id = %L::uuid and code = 'CASH'), 'amount_tendered_minor', 1000)), null, 0, null, null, null, null)$$,
    (select organization_id from phase4_context),
    (select store_id from phase4_context),
    (select register_id from phase4_context),
    (select product_id from phase4_context),
    (select organization_id from phase4_context)
  ),
  '42501',
  'Open your register shift before using transactional POS features.',
  'checkout is blocked before it creates a request without the drawer owner'
);
select throws_ok(
  format(
    $$select * from public.record_cash_movement(%L, %L, 'PAY_IN', 100, 'Blocked movement', 'd4000000-0000-4000-8000-000000000011', null)$$,
    (select organization_id from phase4_context),
    (select shift_id from phase4_context)
  ),
  '42501',
  'Only the employee who opened this shift can record cash movements.',
  'cash movements require the employee who opened the drawer'
);
select throws_ok(
  format(
    $$select * from public.close_register_shift(%L, %L, 10000, 'Blocked close')$$,
    (select organization_id from phase4_context),
    (select shift_id from phase4_context)
  ),
  '42501',
  'Only the employee who opened this shift can close it.',
  'ordinary shift close requires the employee who opened the drawer'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'd4000000-0000-4000-8000-000000000001';

select is(
  public.update_shift_cash_close_setting((select organization_id from phase4_context), false),
  false,
  'settings manager can enable blind cash closing'
);
select is(
  (select expected_cash_minor from public.get_shift_cash_summary(
    (select organization_id from phase4_context),
    (select shift_id from phase4_context)
  )),
  null::bigint,
  'blind cash closing withholds expected cash while the shift is open'
);
select is(
  (select expected_cash_minor from public.close_register_shift(
    (select organization_id from phase4_context),
    (select shift_id from phase4_context),
    10000,
    'Phase 4 blind close'
  )),
  10000::bigint,
  'the close result reveals expected cash after the counted amount is submitted'
);
select is(
  (select expected_cash_minor from public.get_shift_cash_summary(
    (select organization_id from phase4_context),
    (select shift_id from phase4_context)
  )),
  10000::bigint,
  'closed shift reconciliation exposes the immutable expected cash snapshot'
);

select * from finish();
rollback;
