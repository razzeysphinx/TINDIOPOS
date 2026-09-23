begin;

create extension if not exists pgtap
with schema extensions;

set local search_path =
  public,
  extensions;

select plan(7);

insert into auth.users (
  id,
  email,
  raw_user_meta_data
)
values
  (
    '96000000-0000-4000-8000-000000000001',
    'time-clock-provider@tindio.test',
    '{"full_name":"Time Clock Provider"}'::jsonb
  ),
  (
    '96000000-0000-4000-8000-000000000002',
    'time-clock-profile@tindio.test',
    '{"full_name":"Time Clock Profile"}'::jsonb
  );

delete from private.identity_links
where provider =
    'supabase'
  and provider_subject in (
    '96000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000002'
  );

insert into private.identity_links (
  provider,
  provider_subject,
  profile_id
)
values (
  'supabase',
  '96000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000002'
);

insert into public.organizations (
  id,
  name,
  created_by
)
values (
  '96000000-0000-4000-8000-000000000003',
  'Provider-neutral Time Clock',
  '96000000-0000-4000-8000-000000000002'
);

insert into public.stores (
  id,
  organization_id,
  name,
  code
)
values (
  '96000000-0000-4000-8000-000000000004',
  '96000000-0000-4000-8000-000000000003',
  'Provider-neutral Time Clock Store',
  'PNTIME'
);

insert into public.employees (
  id,
  organization_id,
  profile_id,
  employee_number,
  job_title
)
values (
  '96000000-0000-4000-8000-000000000005',
  '96000000-0000-4000-8000-000000000003',
  '96000000-0000-4000-8000-000000000002',
  'PN-TIME-01',
  'Provider-neutral Time Clock Tester'
);

insert into public.employee_stores (
  organization_id,
  employee_id,
  store_id
)
values (
  '96000000-0000-4000-8000-000000000003',
  '96000000-0000-4000-8000-000000000005',
  '96000000-0000-4000-8000-000000000004'
);

set local request.jwt.claim.sub =
  '96000000-0000-4000-8000-000000000001';

set local request.jwt.claims =
  '{"sub":"96000000-0000-4000-8000-000000000001","role":"authenticated"}';

set local role authenticated;

select is(
  public.current_profile_id(),
  '96000000-0000-4000-8000-000000000002'::uuid,
  'external provider subject resolves a distinct permanent TINDIO profile'
);

select lives_ok(
  $$
    select *
    from private.get_current_time_clock_entry(
      '96000000-0000-4000-8000-000000000003'
    )
  $$,
  'provider-neutral current time-clock lookup accepts the mapped profile'
);

select lives_ok(
  $$
    select *
    from private.clock_in_employee(
      '96000000-0000-4000-8000-000000000003',
      '96000000-0000-4000-8000-000000000004',
      null
    )
  $$,
  'provider-neutral mapped employee can clock in to an assigned active store'
);

select is(
  (
    select count(*)
    from public.time_clock_entries
    where organization_id =
        '96000000-0000-4000-8000-000000000003'
      and employee_id =
        '96000000-0000-4000-8000-000000000005'
      and clocked_out_at is null
  ),
  1::bigint,
  'clock-in creates exactly one open entry for the permanent TINDIO employee'
);

select is(
  (
    select store_id
    from private.get_current_time_clock_entry(
      '96000000-0000-4000-8000-000000000003'
    )
  ),
  '96000000-0000-4000-8000-000000000004'::uuid,
  'current time-clock lookup returns the mapped employee active store'
);

select lives_ok(
  $$
    select *
    from private.clock_out_employee(
      '96000000-0000-4000-8000-000000000003',
      null
    )
  $$,
  'provider-neutral mapped employee can clock out'
);

select is(
  (
    select count(*)
    from public.time_clock_entries
    where organization_id =
        '96000000-0000-4000-8000-000000000003'
      and employee_id =
        '96000000-0000-4000-8000-000000000005'
      and clocked_out_at is null
  ),
  0::bigint,
  'clock-out closes the mapped employee open entry'
);

select *
from finish();

rollback;
