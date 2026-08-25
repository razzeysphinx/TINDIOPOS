begin;

-- Payment-method configuration is operationally important: a partially saved
-- method must never be shown as ready at only some stores. These public RPCs
-- keep configuration atomic, retain stable internal codes/types, and enforce
-- the existing settings.manage permission at the database boundary.
create function public.create_store_scoped_payment_method(
  target_organization_id uuid,
  target_name text,
  target_code text,
  target_payment_type text,
  target_requires_reference boolean,
  target_store_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := nullif(btrim(coalesce(target_name, '')), '');
  normalized_code text := upper(nullif(btrim(coalesce(target_code, '')), ''));
  normalized_payment_type text := upper(nullif(btrim(coalesce(target_payment_type, '')), ''));
  target_store_count integer := coalesce(cardinality(target_store_ids), 0);
  created_method_id uuid;
begin
  if target_organization_id is null
    or normalized_name is null
    or char_length(normalized_name) > 100
    or normalized_code is null
    or normalized_code !~ '^[A-Z][A-Z0-9_]{1,39}$'
    or normalized_payment_type is null
    or normalized_payment_type not in ('CASH', 'CARD', 'E_WALLET', 'BANK_TRANSFER', 'VOUCHER', 'OTHER')
    or target_requires_reference is null then
    raise exception 'Enter a valid payment method name, code, category, and reference setting.'
      using errcode = '23514';
  end if;

  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'settings.manage')) then
    raise exception 'Settings permission is required to configure payment methods.' using errcode = '42501';
  end if;

  if target_store_count = 0
    or exists (
      select 1
      from unnest(target_store_ids) as requested(store_id)
      where requested.store_id is null
    )
    or target_store_count <> (
      select count(distinct requested.store_id)
      from unnest(target_store_ids) as requested(store_id)
    )
    or target_store_count <> (
      select count(*)
      from public.stores store
      where store.organization_id = target_organization_id
        and store.is_active
        and store.id = any(target_store_ids)
    ) then
    raise exception 'Select one or more unique active stores in this organization.'
      using errcode = '23514';
  end if;

  insert into public.payment_methods (
    organization_id,
    name,
    code,
    payment_type,
    requires_reference,
    sort_order
  )
  values (
    target_organization_id,
    normalized_name,
    normalized_code,
    normalized_payment_type,
    target_requires_reference,
    100
  )
  returning id into created_method_id;

  insert into public.store_payment_methods (
    organization_id,
    store_id,
    payment_method_id,
    is_enabled
  )
  select
    target_organization_id,
    requested.store_id,
    created_method_id,
    true
  from unnest(target_store_ids) as requested(store_id);

  return created_method_id;
end;
$$;

create function public.update_payment_method_configuration(
  target_organization_id uuid,
  target_payment_method_id uuid,
  target_name text,
  target_is_enabled boolean,
  target_requires_reference boolean,
  target_sort_order integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := nullif(btrim(coalesce(target_name, '')), '');
begin
  if target_organization_id is null
    or target_payment_method_id is null
    or normalized_name is null
    or char_length(normalized_name) > 100
    or target_is_enabled is null
    or target_requires_reference is null
    or target_sort_order is null
    or target_sort_order not between 0 and 100000 then
    raise exception 'Enter valid payment method settings.' using errcode = '23514';
  end if;

  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'settings.manage')) then
    raise exception 'Settings permission is required to configure payment methods.' using errcode = '42501';
  end if;

  update public.payment_methods method
  set
    name = normalized_name,
    is_enabled = target_is_enabled,
    requires_reference = target_requires_reference,
    sort_order = target_sort_order
  where method.organization_id = target_organization_id
    and method.id = target_payment_method_id;

  if not found then
    raise exception 'The payment method was not found in this organization.' using errcode = 'P0002';
  end if;

  return true;
end;
$$;

create function public.set_store_payment_method_configuration(
  target_organization_id uuid,
  target_store_id uuid,
  target_payment_method_id uuid,
  target_is_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_organization_id is null
    or target_store_id is null
    or target_payment_method_id is null
    or target_is_enabled is null then
    raise exception 'Choose a payment method, active store, and availability setting.' using errcode = '23514';
  end if;

  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'settings.manage')) then
    raise exception 'Settings permission is required to configure payment methods.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.payment_methods method
    where method.organization_id = target_organization_id
      and method.id = target_payment_method_id
  ) then
    raise exception 'The payment method was not found in this organization.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.stores store
    where store.organization_id = target_organization_id
      and store.id = target_store_id
      and store.is_active
  ) then
    raise exception 'The store is not active in this organization.' using errcode = '23514';
  end if;

  insert into public.store_payment_methods (
    organization_id,
    store_id,
    payment_method_id,
    is_enabled
  )
  values (
    target_organization_id,
    target_store_id,
    target_payment_method_id,
    target_is_enabled
  )
  on conflict (store_id, payment_method_id) do update
  set is_enabled = excluded.is_enabled;

  return true;
end;
$$;

-- Configuration flows must use the functions above. Existing SELECT access
-- remains available for the POS and Back Office; checkout still validates the
-- method's internal type and store availability independently.
revoke insert on table public.payment_methods from authenticated;
revoke update (name, is_enabled, requires_reference, sort_order)
on table public.payment_methods from authenticated;
revoke insert on table public.store_payment_methods from authenticated;
revoke update (is_enabled) on table public.store_payment_methods from authenticated;

revoke execute on function public.create_store_scoped_payment_method(uuid, text, text, text, boolean, uuid[])
from public, anon, service_role;
revoke execute on function public.update_payment_method_configuration(uuid, uuid, text, boolean, boolean, integer)
from public, anon, service_role;
revoke execute on function public.set_store_payment_method_configuration(uuid, uuid, uuid, boolean)
from public, anon, service_role;
grant execute on function public.create_store_scoped_payment_method(uuid, text, text, text, boolean, uuid[])
to authenticated;
grant execute on function public.update_payment_method_configuration(uuid, uuid, text, boolean, boolean, integer)
to authenticated;
grant execute on function public.set_store_payment_method_configuration(uuid, uuid, uuid, boolean)
to authenticated;

comment on function public.create_store_scoped_payment_method(uuid, text, text, text, boolean, uuid[])
is 'Creates a stable-code payment method and all selected active-store mappings atomically for a settings manager.';
comment on function public.update_payment_method_configuration(uuid, uuid, text, boolean, boolean, integer)
is 'Updates safe payment-method configuration fields without changing its reporting code or category.';
comment on function public.set_store_payment_method_configuration(uuid, uuid, uuid, boolean)
is 'Sets availability of one organization payment method at one active organization store.';

notify pgrst, 'reload schema';

commit;
