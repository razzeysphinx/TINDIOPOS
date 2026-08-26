begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

select ok(
  to_regprocedure('public.delete_unused_setup_record(uuid,text,uuid,text)') is not null,
  'guarded setup-record deletion routine exists'
);
select ok(
  has_function_privilege('authenticated', 'public.delete_unused_setup_record(uuid,text,uuid,text)', 'execute'),
  'authenticated callers may execute the guarded deletion routine'
);
select ok(
  not has_function_privilege('anon', 'public.delete_unused_setup_record(uuid,text,uuid,text)', 'execute'),
  'anonymous callers cannot execute the guarded deletion routine'
);

insert into auth.users (id, email, raw_user_meta_data)
values ('26262626-2626-4626-8626-262626262626', 'guarded-delete-owner@tindio.test', '{"full_name":"Guarded Delete Owner"}'::jsonb);

create temporary table guarded_delete_context (
  organization_id uuid not null,
  employee_id uuid,
  disposable_category_id uuid,
  active_category_id uuid,
  assigned_role_id uuid
);
grant select, insert, update on guarded_delete_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '26262626-2626-4626-8626-262626262626';

insert into guarded_delete_context (organization_id)
select organization_id
from public.bootstrap_organization('Guarded Delete Retail', 'Guarded Delete Main', 'Guarded Delete Counter');

update guarded_delete_context
set employee_id = employee.id
from public.employees employee
where employee.organization_id = guarded_delete_context.organization_id
  and employee.profile_id = '26262626-2626-4626-8626-262626262626';

with inserted as (
  insert into public.categories (organization_id, name, is_archived)
  select organization_id, 'Disposable category', true
  from guarded_delete_context
  returning id
)
update guarded_delete_context
set disposable_category_id = (select id from inserted);

select is(
  public.delete_unused_setup_record(
    (select organization_id from guarded_delete_context),
    'category',
    (select disposable_category_id from guarded_delete_context),
    'Disposable category'
  ),
  'Disposable category',
  'an archived, unused category can be permanently deleted'
);
select is(
  (select count(*) from public.categories where id = (select disposable_category_id from guarded_delete_context)),
  0::bigint,
  'permanently deleted category no longer exists'
);

with inserted as (
  insert into public.categories (organization_id, name, is_archived)
  select organization_id, 'Still active category', false
  from guarded_delete_context
  returning id
)
update guarded_delete_context
set active_category_id = (select id from inserted);

select throws_ok(
  format(
    $$select public.delete_unused_setup_record(%L::uuid, 'category', %L::uuid, 'Still active category')$$,
    (select organization_id from guarded_delete_context),
    (select active_category_id from guarded_delete_context)
  ),
  '23514',
  'Archive or disable this record before permanently deleting it.',
  'active records must be archived before permanent deletion'
);

with inserted as (
  insert into public.roles (organization_id, name, code, is_system)
  select organization_id, 'Disposable assigned role', 'disposable_assigned_role', false
  from guarded_delete_context
  returning id
)
update guarded_delete_context
set assigned_role_id = (select id from inserted);

insert into public.employee_roles (organization_id, employee_id, role_id)
select organization_id, employee_id, assigned_role_id
from guarded_delete_context;

select throws_ok(
  format(
    $$select public.delete_unused_setup_record(%L::uuid, 'custom_role', %L::uuid, 'Disposable assigned role')$$,
    (select organization_id from guarded_delete_context),
    (select assigned_role_id from guarded_delete_context)
  ),
  '23514',
  'This role is assigned to employees. Reassign them before deletion.',
  'roles assigned to employees cannot be permanently deleted'
);

select * from finish();
rollback;
