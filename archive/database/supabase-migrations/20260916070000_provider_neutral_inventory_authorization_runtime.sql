-- TINDIO R3.2
-- Provider-neutral inventory authorization runtime closure.
--
-- This migration changes identity resolution only.
--
-- External authentication subjects are resolved through:
--
--   private.current_identity_subject()
--     -> private.identity_links
--     -> private.current_profile_id()
--
-- Inventory capability, store-scope, and inventory-actor
-- authorization must use the permanent TINDIO profile identity.
--
-- No inventory mathematics, ledger behavior, RBAC compatibility,
-- store assignment behavior, public RPC contracts, or document
-- lifecycle semantics are changed here.

begin;

create or replace function private.has_inventory_capability(
  target_organization_id uuid,
  requested_capability text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select private.current_profile_id())
      is not null

    and exists (
      select 1
      from public.organizations organization
      where organization.id =
        target_organization_id
        and organization.status =
          'active'
    )

    and exists (
      select 1
      from public.employees employee

      join public.employee_roles
        employee_role
        on employee_role.employee_id =
          employee.id
       and employee_role.organization_id =
          employee.organization_id

      join public.role_permissions
        role_permission
        on role_permission.role_id =
          employee_role.role_id
       and role_permission.organization_id =
          employee_role.organization_id

      where employee.organization_id =
        target_organization_id

        and employee.profile_id =
          (
            select
              private.current_profile_id()
          )

        and employee.status =
          'active'

        and (
          role_permission.permission_code =
            requested_capability

          or role_permission.permission_code =
            'inventory.manage'

          or (
            requested_capability in (
              'inventory.transfer.create',
              'inventory.transfer.send',
              'inventory.transfer.receive'
            )
            and role_permission.permission_code =
              'inventory.transfers'
          )

          or (
            requested_capability in (
              'inventory.count.create',
              'inventory.count.finalize'
            )
            and role_permission.permission_code =
              'inventory.count'
          )

          or (
            requested_capability in (
              'inventory.adjust.create',
              'inventory.adjust.post'
            )
            and role_permission.permission_code =
              'inventory.adjust'
          )

          or (
            requested_capability in (
              'purchasing.view',
              'purchasing.po.create'
            )
            and role_permission.permission_code =
              'inventory.purchase_orders'
          )

          or (
            requested_capability =
              'purchasing.receive'
            and role_permission.permission_code =
              'inventory.receive'
          )

          or (
            requested_capability =
              'purchasing.suppliers.manage'
            and role_permission.permission_code =
              'inventory.suppliers'
          )

          or (
            requested_capability =
              'inventory.valuation.view'
            and role_permission.permission_code =
              'products.view_cost'
          )
        )
    ),
    false
  );
$$;

comment on function
  private.has_inventory_capability(
    uuid,
    text
  )
is
'Provider-neutral capability-based inventory authorization using the permanent TINDIO profile identity, while preserving explicit legacy inventory permission compatibility. No role names are used.';


create or replace function private.has_store_read_scope(
  target_organization_id uuid,
  target_store_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select private.current_profile_id())
      is not null

    and target_store_id is not null

    and exists (
      select 1
      from public.organizations organization
      where organization.id =
        target_organization_id
        and organization.status =
          'active'
    )

    and (
      (
        select
          private.has_organization_store_scope(
            target_organization_id
          )
      )

      or exists (
        select 1
        from public.employees employee

        join public.employee_stores
          assignment
          on assignment.organization_id =
            employee.organization_id
         and assignment.employee_id =
            employee.id

        where employee.organization_id =
          target_organization_id

          and employee.profile_id =
            (
              select
                private.current_profile_id()
            )

          and employee.status =
            'active'

          and assignment.store_id =
            target_store_id
      )
    ),
    false
  );
$$;

comment on function
  private.has_store_read_scope(
    uuid,
    uuid
  )
is
'Provider-neutral active-employee store read scope using the permanent TINDIO profile identity, active organization state, organization-wide authority, or explicit store assignment.';


create or replace function private.inventory_actor(
  target_organization_id uuid,
  target_store_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select employee.id

  from public.employees employee

  where employee.organization_id =
      target_organization_id

    and employee.profile_id =
      (
        select
          private.current_profile_id()
      )

    and employee.status =
      'active'

    and (
      select private.has_store_read_scope(
        target_organization_id,
        target_store_id
      )
    )

  order by employee.created_at

  limit 1;
$$;

comment on function
  private.inventory_actor(
    uuid,
    uuid
  )
is
'Resolves the active inventory employee through the permanent provider-neutral TINDIO profile identity while preserving canonical store-scope authorization.';

commit;
