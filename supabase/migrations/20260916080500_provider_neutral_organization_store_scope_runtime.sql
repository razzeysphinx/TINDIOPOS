-- TINDIO R3.3
-- Provider-neutral organization-wide store-scope runtime closure.
--
-- Identity resolution only.
--
-- The stores.manage authorization model, active-organization requirement,
-- role capability semantics, store-assignment semantics, RLS behavior,
-- and callable surface remain unchanged.
--
-- Provider-specific authentication subjects must not be interpreted as
-- permanent TINDIO profile IDs inside business authorization.

begin;

create or replace function private.has_organization_store_scope(
  target_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select private.current_profile_id()
    ) is not null

    and exists (
      select 1
      from public.organizations organization
      where organization.id =
        target_organization_id
        and organization.status =
          'active'
    )

    and (
      select private.has_permission(
        target_organization_id,
        'stores.manage'
      )
    ),

    false
  );
$$;

comment on function
  private.has_organization_store_scope(uuid)
is
'Provider-neutral capability-defined organization-wide store scope. Requires a mapped permanent TINDIO profile, active organization, active employee permission resolution, and stores.manage.';

commit;
