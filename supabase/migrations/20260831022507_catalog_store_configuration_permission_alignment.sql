-- The store configuration action uses INSERT ... ON CONFLICT DO UPDATE so an
-- authorized catalog manager can save both a new configuration and a legacy
-- configuration with the same request. The original column grants allowed
-- price/low-stock updates but not their INSERT path, causing PostgreSQL to
-- reject the upsert with 42501 before its capability/RLS policies ran.
--
-- This only aligns table privileges with the existing products.manage plus
-- store-scope policies; it does not introduce an Owner-specific bypass.
begin;

grant insert (
  price_override_minor,
  low_stock_level
) on public.product_store_settings to authenticated;

-- Owner is a predefined permission bundle, not a runtime access exception.
-- Keep that bundle complete when a later migration registers a new capability,
-- then repair all existing Owner roles in the same migration. Custom roles
-- continue to receive exactly the explicit role_permissions a business assigns.
create or replace function private.grant_new_permissions_to_owner_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.role_permissions (organization_id, role_id, permission_code)
  select role.organization_id, role.id, new.code
  from public.roles role
  where role.is_system
    and role.code = 'owner'
  on conflict do nothing;

  return new;
end;
$$;

revoke execute on function private.grant_new_permissions_to_owner_roles()
from public, anon, authenticated, service_role;

drop trigger if exists permissions_grant_owner_default on public.permissions;
create trigger permissions_grant_owner_default
after insert on public.permissions
for each row execute function private.grant_new_permissions_to_owner_roles();

insert into public.role_permissions (organization_id, role_id, permission_code)
select role.organization_id, role.id, permission.code
from public.roles role
cross join public.permissions permission
where role.is_system
  and role.code = 'owner'
on conflict do nothing;

comment on function private.grant_new_permissions_to_owner_roles()
is 'Keeps the predefined Owner permission bundle synchronized with registered capabilities; runtime authorization still uses role_permissions.';

comment on trigger permissions_grant_owner_default on public.permissions
is 'Synchronizes each newly registered capability to every predefined Owner role.';

commit;
