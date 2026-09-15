begin;

create extension if not exists pgtap
with schema extensions;

select plan(29);

insert into auth.users (
  id,
  email,
  raw_user_meta_data
)
values
  (
    '66666666-6666-4666-8666-666666666666',
    'r3-alpha@tindio.test',
    '{"full_name":"R3 Alpha"}'::jsonb
  ),
  (
    '77777777-7777-4777-8777-777777777777',
    'r3-beta@tindio.test',
    '{"full_name":"R3 Beta"}'::jsonb
  );

create temporary table test_context (
  label text primary key,
  organization_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  employee_id uuid
);

grant select, insert, update
on table test_context
to authenticated;

set local role authenticated;

set local request.jwt.claim.sub =
  '66666666-6666-4666-8666-666666666666';

set local request.jwt.claims =
  '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated","email":"r3-alpha@tindio.test"}';

insert into test_context (
  label,
  organization_id,
  store_id,
  register_id
)
select
  'alpha',
  organization_id,
  store_id,
  register_id
from public.bootstrap_organization(
  'R3 Alpha Organization',
  'R3 Alpha Store',
  'R3 Alpha Register'
);

reset role;

set local role authenticated;

set local request.jwt.claim.sub =
  '77777777-7777-4777-8777-777777777777';

set local request.jwt.claims =
  '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated","email":"r3-beta@tindio.test"}';

insert into test_context (
  label,
  organization_id,
  store_id,
  register_id
)
select
  'beta',
  organization_id,
  store_id,
  register_id
from public.bootstrap_organization(
  'R3 Beta Organization',
  'R3 Beta Store',
  'R3 Beta Register'
);

reset role;

update test_context context
set employee_id = employee.id
from public.employees employee
where employee.organization_id =
    context.organization_id
  and (
    (
      context.label = 'alpha'
      and employee.profile_id =
        '66666666-6666-4666-8666-666666666666'
    )
    or
    (
      context.label = 'beta'
      and employee.profile_id =
        '77777777-7777-4777-8777-777777777777'
    )
  );

-- Replace Alpha's original provider link with a deliberately different
-- external authentication subject.
delete from private.identity_links
where provider = 'supabase'
  and provider_subject =
    '66666666-6666-4666-8666-666666666666'
  and profile_id =
    '66666666-6666-4666-8666-666666666666';

insert into private.identity_links (
  provider,
  provider_subject,
  profile_id
)
values (
  'supabase',
  '88888888-8888-4888-8888-888888888888',
  '66666666-6666-4666-8666-666666666666'
);

select ok(
  to_regprocedure(
    'private.current_employee_id(uuid)'
  ) is not null,
  'current_employee_id exists'
);

select ok(
  to_regprocedure(
    'private.is_organization_creator(uuid)'
  ) is not null,
  'is_organization_creator exists'
);

select ok(
  to_regprocedure(
    'private.is_organization_member(uuid)'
  ) is not null,
  'is_organization_member exists'
);

select ok(
  to_regprocedure(
    'private.has_permission(uuid,text)'
  ) is not null,
  'has_permission exists'
);

select ok(
  to_regprocedure(
    'private.can_view_employee_profile(uuid)'
  ) is not null,
  'can_view_employee_profile exists'
);

select ok(
  to_regprocedure(
    'private.activate_manager_approval(uuid,uuid,text,jsonb,uuid)'
  ) is not null,
  'activate_manager_approval exists'
);

select is(
  has_function_privilege(
    'authenticated',
    'private.current_employee_id(uuid)',
    'EXECUTE'
  ),
  true,
  'authenticated can execute current_employee_id'
);

select is(
  has_function_privilege(
    'authenticated',
    'private.is_organization_creator(uuid)',
    'EXECUTE'
  ),
  true,
  'authenticated can execute is_organization_creator'
);

select is(
  has_function_privilege(
    'authenticated',
    'private.is_organization_member(uuid)',
    'EXECUTE'
  ),
  true,
  'authenticated can execute is_organization_member'
);

select is(
  has_function_privilege(
    'authenticated',
    'private.has_permission(uuid,text)',
    'EXECUTE'
  ),
  true,
  'authenticated can execute has_permission'
);

select is(
  has_function_privilege(
    'authenticated',
    'private.can_view_employee_profile(uuid)',
    'EXECUTE'
  ),
  true,
  'authenticated can execute can_view_employee_profile'
);

select is(
  has_function_privilege(
    'authenticated',
    'private.activate_manager_approval(uuid,uuid,text,jsonb,uuid)',
    'EXECUTE'
  ),
  false,
  'activate_manager_approval remains internal'
);

set local request.jwt.claim.sub =
  '88888888-8888-4888-8888-888888888888';

set local request.jwt.claims =
  '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated"}';

select is(
  private.current_profile_id(),
  '66666666-6666-4666-8666-666666666666'::uuid,
  'external subject maps to permanent Alpha profile'
);

set local role authenticated;

select is(
  private.current_employee_id(
    (
      select organization_id
      from test_context
      where label = 'alpha'
    )
  ),
  (
    select employee_id
    from test_context
    where label = 'alpha'
  ),
  'remapped identity resolves Alpha employee'
);

select is(
  private.is_organization_creator(
    (
      select organization_id
      from test_context
      where label = 'alpha'
    )
  ),
  true,
  'remapped identity remains Alpha creator'
);

select is(
  private.is_organization_member(
    (
      select organization_id
      from test_context
      where label = 'alpha'
    )
  ),
  true,
  'remapped identity remains Alpha member'
);

select is(
  private.has_permission(
    (
      select organization_id
      from test_context
      where label = 'alpha'
    ),
    'organization.manage'
  ),
  true,
  'remapped identity retains Alpha permissions'
);

select is(
  private.can_view_employee_profile(
    '66666666-6666-4666-8666-666666666666'::uuid
  ),
  true,
  'remapped identity can view permanent Alpha profile'
);

select is(
  private.is_organization_creator(
    (
      select organization_id
      from test_context
      where label = 'beta'
    )
  ),
  false,
  'Alpha is not Beta creator'
);

select is(
  private.is_organization_member(
    (
      select organization_id
      from test_context
      where label = 'beta'
    )
  ),
  false,
  'Alpha is not Beta member'
);

select is(
  private.has_permission(
    (
      select organization_id
      from test_context
      where label = 'beta'
    ),
    'organization.manage'
  ),
  false,
  'Alpha receives no Beta permission'
);

select is(
  private.can_view_employee_profile(
    '77777777-7777-4777-8777-777777777777'::uuid
  ),
  false,
  'Alpha cannot view unauthorized Beta profile'
);

reset role;

select set_config(
  'tindio.approval_profile_id',
  '88888888-8888-4888-8888-888888888888',
  true
);

select set_config(
  'tindio.approval_organization_id',
  (
    select organization_id::text
    from test_context
    where label = 'alpha'
  ),
  true
);

select set_config(
  'tindio.approval_permission',
  'r3.synthetic.approval',
  true
);

set local role authenticated;

select is(
  private.has_permission(
    (
      select organization_id
      from test_context
      where label = 'alpha'
    ),
    'r3.synthetic.approval'
  ),
  false,
  'provider subject cannot impersonate approval profile context'
);

reset role;

select set_config(
  'tindio.approval_profile_id',
  '66666666-6666-4666-8666-666666666666',
  true
);

set local role authenticated;

select is(
  private.has_permission(
    (
      select organization_id
      from test_context
      where label = 'alpha'
    ),
    'r3.synthetic.approval'
  ),
  true,
  'permanent TINDIO profile activates matching approval context'
);

reset role;

set local request.jwt.claim.sub =
  '99999999-9999-4999-8999-999999999999';

set local request.jwt.claims =
  '{"sub":"99999999-9999-4999-8999-999999999999","role":"authenticated"}';

set local role authenticated;

select is(
  private.current_employee_id(
    (
      select organization_id
      from test_context
      where label = 'alpha'
    )
  ),
  null::uuid,
  'unmapped identity has no employee'
);

select is(
  private.is_organization_creator(
    (
      select organization_id
      from test_context
      where label = 'alpha'
    )
  ),
  false,
  'unmapped identity cannot be creator'
);

select is(
  private.is_organization_member(
    (
      select organization_id
      from test_context
      where label = 'alpha'
    )
  ),
  false,
  'unmapped identity cannot be member'
);

select is(
  private.has_permission(
    (
      select organization_id
      from test_context
      where label = 'alpha'
    ),
    'organization.manage'
  ),
  false,
  'unmapped identity receives no permission'
);

select ok(
  not coalesce(
    private.can_view_employee_profile(
      '66666666-6666-4666-8666-666666666666'::uuid
    ),
    false
  ),
  'unmapped identity cannot view Alpha profile'
);

select * from finish();

rollback;
