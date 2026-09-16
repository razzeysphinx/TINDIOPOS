begin;

create extension if not exists pgtap
with schema extensions;

select plan(23);

insert into auth.users (
  id,
  email,
  raw_user_meta_data
)
values
  (
    '62626262-6262-4626-8626-626262626261',
    'provider-inventory-alpha-owner@tindio.test',
    '{"full_name":"Provider Inventory Alpha Owner"}'::jsonb
  ),
  (
    '62626262-6262-4626-8626-626262626262',
    'provider-inventory-alpha-operator@tindio.test',
    '{"full_name":"Provider Inventory Alpha Operator"}'::jsonb
  ),
  (
    '73737373-7373-4737-8737-737373737371',
    'provider-inventory-beta-owner@tindio.test',
    '{"full_name":"Provider Inventory Beta Owner"}'::jsonb
  );

create temporary table
provider_inventory_context (
  label text primary key,
  organization_id uuid not null,
  store_id uuid not null,
  unassigned_store_id uuid,
  register_id uuid not null,
  product_id uuid,
  operator_employee_id uuid
);

grant
  select,
  insert,
  update
on table provider_inventory_context
to authenticated;


/*
 * Bootstrap Alpha using its original provider subject.
 */
set local role authenticated;

set local request.jwt.claim.sub =
  '62626262-6262-4626-8626-626262626261';

set local request.jwt.claims =
  '{"sub":"62626262-6262-4626-8626-626262626261","role":"authenticated"}';

insert into provider_inventory_context (
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
  'Provider Inventory Alpha',
  'Provider Inventory Alpha Store',
  'Provider Inventory Alpha Register'
);

update provider_inventory_context
set product_id =
  public.create_catalog_product(
    organization_id,
    null,
    'Provider Inventory Alpha Item',
    'Provider-neutral inventory authorization fixture.',
    'simple',
    'PNIA-ALPHA',
    '480000062626',
    1000,
    100,
    true,
    'each',
    array[store_id],
    '[]'::jsonb
  )
where label = 'alpha';

reset role;


/*
 * Create a second active Alpha store that the narrow operator will NOT be
 * assigned to.
 *
 * The existing product is then enabled in that store, which initializes a
 * second real inventory_levels row.
 *
 * Before stores.manage:
 *   operator sees 1 Alpha stock row.
 *
 * After stores.manage:
 *   operator sees 2 Alpha stock rows.
 *
 * This proves organization-wide store scope through actual RLS, not only
 * through helper return values.
 */
with created_store as (
  insert into public.stores (
    organization_id,
    name,
    code
  )
  select
    organization_id,
    'Provider Inventory Alpha Unassigned Store',
    'PNIA-UNASSIGNED'
  from provider_inventory_context
  where label = 'alpha'
  returning id
)
update provider_inventory_context
set unassigned_store_id = (
  select id
  from created_store
)
where label = 'alpha';

insert into public.product_store_settings (
  organization_id,
  store_id,
  product_id,
  is_available
)
select
  organization_id,
  unassigned_store_id,
  product_id,
  true
from provider_inventory_context
where label = 'alpha';


/*
 * Bootstrap Beta and create real stock projection data so the
 * cross-tenant RLS assertion cannot pass merely because Beta has no rows.
 */
set local role authenticated;

set local request.jwt.claim.sub =
  '73737373-7373-4737-8737-737373737371';

set local request.jwt.claims =
  '{"sub":"73737373-7373-4737-8737-737373737371","role":"authenticated"}';

insert into provider_inventory_context (
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
  'Provider Inventory Beta',
  'Provider Inventory Beta Store',
  'Provider Inventory Beta Register'
);

update provider_inventory_context
set product_id =
  public.create_catalog_product(
    organization_id,
    null,
    'Provider Inventory Beta Item',
    'Cross-tenant provider-neutral inventory fixture.',
    'simple',
    'PNIA-BETA',
    '480000073737',
    1000,
    100,
    true,
    'each',
    array[store_id],
    '[]'::jsonb
  )
where label = 'beta';

reset role;


/*
 * Create a deliberately narrow Alpha custom role.
 *
 * It receives ONLY inventory.adjust.create.
 *
 * This prevents the runtime proof from succeeding through
 * inventory.manage or another broad preset permission.
 */
insert into public.employees (
  organization_id,
  profile_id,
  employee_number,
  job_title
)
select
  organization_id,
  '62626262-6262-4626-8626-626262626262'::uuid,
  'PNIA-OP-001',
  'Provider-neutral inventory operator'
from provider_inventory_context
where label = 'alpha';

update provider_inventory_context context
set operator_employee_id =
  employee.id
from public.employees employee
where context.label = 'alpha'
  and employee.organization_id =
    context.organization_id
  and employee.profile_id =
    '62626262-6262-4626-8626-626262626262'::uuid;

insert into public.roles (
  organization_id,
  name,
  code,
  is_system
)
select
  organization_id,
  'Provider-neutral inventory operator',
  'provider_neutral_inventory_operator',
  false
from provider_inventory_context
where label = 'alpha';

insert into public.role_permissions (
  organization_id,
  role_id,
  permission_code
)
select
  role.organization_id,
  role.id,
  'inventory.adjust.create'
from public.roles role
join provider_inventory_context context
  on context.organization_id =
    role.organization_id
where context.label = 'alpha'
  and role.code =
    'provider_neutral_inventory_operator';

insert into public.employee_roles (
  organization_id,
  employee_id,
  role_id
)
select
  context.organization_id,
  context.operator_employee_id,
  role.id
from provider_inventory_context context
join public.roles role
  on role.organization_id =
    context.organization_id
 and role.code =
    'provider_neutral_inventory_operator'
where context.label = 'alpha';

insert into public.employee_stores (
  organization_id,
  employee_id,
  store_id
)
select
  organization_id,
  operator_employee_id,
  store_id
from provider_inventory_context
where label = 'alpha';


/*
 * Replace the operator's original provider link with a different
 * external provider subject.
 *
 * Permanent TINDIO profile:
 *
 *   62626262-6262-4626-8626-626262626262
 *
 * External provider subject:
 *
 *   84848484-8484-4848-8848-848484848484
 */
delete from private.identity_links
where provider = 'supabase'
  and profile_id =
    '62626262-6262-4626-8626-626262626262'::uuid;

insert into private.identity_links (
  provider,
  provider_subject,
  profile_id
)
values (
  'supabase',
  '84848484-8484-4848-8848-848484848484',
  '62626262-6262-4626-8626-626262626262'
);


/*
 * Provider-neutral identity resolution.
 */
set local request.jwt.claim.sub =
  '84848484-8484-4848-8848-848484848484';

set local request.jwt.claims =
  '{"sub":"84848484-8484-4848-8848-848484848484","role":"authenticated"}';

select is(
  private.current_profile_id(),
  '62626262-6262-4626-8626-626262626262'::uuid,
  'remapped provider subject resolves the permanent Alpha operator profile'
);

select is(
  private.inventory_actor(
    (
      select organization_id
      from provider_inventory_context
      where label = 'alpha'
    ),
    (
      select store_id
      from provider_inventory_context
      where label = 'alpha'
    )
  ),
  (
    select operator_employee_id
    from provider_inventory_context
    where label = 'alpha'
  ),
  'remapped provider identity resolves the canonical Alpha inventory actor'
);

select is(
  private.inventory_actor(
    (
      select organization_id
      from provider_inventory_context
      where label = 'beta'
    ),
    (
      select store_id
      from provider_inventory_context
      where label = 'beta'
    )
  ),
  null::uuid,
  'Alpha remapped identity cannot resolve a Beta inventory actor'
);

select is(
  has_function_privilege(
    'authenticated',
    'private.has_organization_store_scope(uuid)',
    'EXECUTE'
  ),
  false,
  'organization-wide store-scope resolver remains an internal authorization helper'
);

select is(
  private.has_organization_store_scope(
    (
      select organization_id
      from provider_inventory_context
      where label = 'alpha'
    )
  ),
  false,
  'remapped Alpha operator without stores.manage has no organization-wide store scope'
);


/*
 * Capability and RLS assertions execute as the authenticated caller.
 */
set local role authenticated;

select is(
  private.has_inventory_capability(
    (
      select organization_id
      from provider_inventory_context
      where label = 'alpha'
    ),
    'inventory.adjust.create'
  ),
  true,
  'remapped Alpha operator keeps its granular adjustment-create capability'
);

select is(
  private.has_inventory_capability(
    (
      select organization_id
      from provider_inventory_context
      where label = 'alpha'
    ),
    'inventory.adjust.post'
  ),
  false,
  'remapped Alpha operator does not receive an unassigned adjustment-post capability'
);

select is(
  private.has_any_inventory_capability(
    (
      select organization_id
      from provider_inventory_context
      where label = 'alpha'
    ),
    array[
      'inventory.adjust.create',
      'inventory.count.create'
    ]::text[]
  ),
  true,
  'provider-neutral any-capability delegation resolves through the hardened capability helper'
);

select is(
  private.has_all_inventory_capabilities(
    (
      select organization_id
      from provider_inventory_context
      where label = 'alpha'
    ),
    array[
      'inventory.adjust.create',
      'inventory.adjust.post'
    ]::text[]
  ),
  false,
  'provider-neutral all-capability delegation does not manufacture missing authority'
);

select is(
  private.has_inventory_capability(
    (
      select organization_id
      from provider_inventory_context
      where label = 'beta'
    ),
    'inventory.adjust.create'
  ),
  false,
  'Alpha remapped identity receives no Beta inventory capability'
);

select is(
  private.has_store_read_scope(
    (
      select organization_id
      from provider_inventory_context
      where label = 'alpha'
    ),
    (
      select store_id
      from provider_inventory_context
      where label = 'alpha'
    )
  ),
  true,
  'remapped Alpha operator retains its assigned Alpha store scope'
);

select is(
  private.has_store_read_scope(
    (
      select organization_id
      from provider_inventory_context
      where label = 'beta'
    ),
    (
      select store_id
      from provider_inventory_context
      where label = 'beta'
    )
  ),
  false,
  'Alpha remapped identity receives no Beta store scope'
);

select is(
  private.has_store_read_scope(
    (
      select organization_id
      from provider_inventory_context
      where label = 'alpha'
    ),
    (
      select unassigned_store_id
      from provider_inventory_context
      where label = 'alpha'
    )
  ),
  false,
  'remapped Alpha operator cannot read an unassigned Alpha store before stores.manage is granted'
);

select is(
  (
    select count(*)
    from public.inventory_levels
    where organization_id = (
      select organization_id
      from provider_inventory_context
      where label = 'alpha'
    )
  ),
  1::bigint,
  'remapped granular Alpha operator can read its assigned-store stock projection'
);

select is(
  (
    select count(*)
    from public.inventory_levels
    where organization_id = (
      select organization_id
      from provider_inventory_context
      where label = 'beta'
    )
  ),
  0::bigint,
  'remapped Alpha operator cannot read Beta stock projection'
);

reset role;


/*
 * Promote the same CUSTOM role with stores.manage.
 *
 * Authorization remains capability-based. No role-name special case is used.
 */
insert into public.role_permissions (
  organization_id,
  role_id,
  permission_code
)
select
  role.organization_id,
  role.id,
  'stores.manage'
from public.roles role
join provider_inventory_context context
  on context.organization_id =
    role.organization_id
where context.label = 'alpha'
  and role.code =
    'provider_neutral_inventory_operator'
on conflict do nothing;


select is(
  private.has_organization_store_scope(
    (
      select organization_id
      from provider_inventory_context
      where label = 'alpha'
    )
  ),
  true,
  'remapped Alpha custom role gains organization-wide scope through stores.manage'
);


set local role authenticated;

select is(
  private.has_store_read_scope(
    (
      select organization_id
      from provider_inventory_context
      where label = 'alpha'
    ),
    (
      select unassigned_store_id
      from provider_inventory_context
      where label = 'alpha'
    )
  ),
  true,
  'stores.manage grants the remapped Alpha operator access to the unassigned Alpha store'
);

select is(
  (
    select count(*)
    from public.inventory_levels
    where organization_id = (
      select organization_id
      from provider_inventory_context
      where label = 'alpha'
    )
  ),
  2::bigint,
  'organization-wide remapped Alpha operator reads both real Alpha stock projections'
);

reset role;


/*
 * An authenticated but unmapped external subject must fail closed.
 */
set local request.jwt.claim.sub =
  '95959595-9595-4959-8959-959595959595';

set local request.jwt.claims =
  '{"sub":"95959595-9595-4959-8959-959595959595","role":"authenticated"}';

select is(
  private.current_profile_id(),
  null::uuid,
  'unmapped external subject has no permanent TINDIO profile'
);

select is(
  private.inventory_actor(
    (
      select organization_id
      from provider_inventory_context
      where label = 'alpha'
    ),
    (
      select store_id
      from provider_inventory_context
      where label = 'alpha'
    )
  ),
  null::uuid,
  'unmapped external subject cannot resolve an inventory actor'
);

set local role authenticated;

select is(
  private.has_inventory_capability(
    (
      select organization_id
      from provider_inventory_context
      where label = 'alpha'
    ),
    'inventory.adjust.create'
  ),
  false,
  'unmapped external subject receives no inventory capability'
);

select is(
  private.has_store_read_scope(
    (
      select organization_id
      from provider_inventory_context
      where label = 'alpha'
    ),
    (
      select store_id
      from provider_inventory_context
      where label = 'alpha'
    )
  ),
  false,
  'unmapped external subject receives no store scope'
);

select is(
  (
    select count(*)
    from public.inventory_levels
    where organization_id = (
      select organization_id
      from provider_inventory_context
      where label = 'alpha'
    )
  ),
  0::bigint,
  'unmapped external subject cannot read Alpha stock projection'
);

select * from finish();

rollback;
