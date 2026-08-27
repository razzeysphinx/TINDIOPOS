-- TINDIO Planning Document Phase 8: presets-first configuration UX.
--
-- Built-in payment codes are not custom records. This retains their stable
-- reporting meaning, while letting a settings manager restore a preset that
-- was safely removed before it had payment history.

begin;

create or replace function public.create_store_scoped_payment_method(
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

  if normalized_code in ('CASH', 'CARD', 'GCASH', 'MAYA', 'BANK_TRANSFER') then
    raise exception 'TINDIO default payment methods are managed from the preset list.'
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

create function public.restore_tindio_payment_preset(
  target_organization_id uuid,
  target_preset_code text,
  target_store_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_preset_code text := upper(nullif(btrim(coalesce(target_preset_code, '')), ''));
  preset_name text;
  preset_payment_type text;
  preset_requires_reference boolean;
  preset_sort_order integer;
  target_store_count integer := coalesce(cardinality(target_store_ids), 0);
  restored_method_id uuid;
begin
  if target_organization_id is null then
    raise exception 'Choose the organization for this payment preset.' using errcode = '23514';
  end if;

  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'settings.manage')) then
    raise exception 'Settings permission is required to restore payment presets.' using errcode = '42501';
  end if;

  case normalized_preset_code
    when 'CASH' then
      preset_name := 'Cash';
      preset_payment_type := 'CASH';
      preset_requires_reference := false;
      preset_sort_order := 10;
    when 'CARD' then
      preset_name := 'Card';
      preset_payment_type := 'CARD';
      preset_requires_reference := false;
      preset_sort_order := 20;
    when 'GCASH' then
      preset_name := 'GCash';
      preset_payment_type := 'E_WALLET';
      preset_requires_reference := false;
      preset_sort_order := 30;
    when 'MAYA' then
      preset_name := 'Maya';
      preset_payment_type := 'E_WALLET';
      preset_requires_reference := false;
      preset_sort_order := 40;
    when 'BANK_TRANSFER' then
      preset_name := 'Bank Transfer';
      preset_payment_type := 'BANK_TRANSFER';
      preset_requires_reference := false;
      preset_sort_order := 50;
    else
      raise exception 'Choose a valid TINDIO payment preset.' using errcode = '23514';
  end case;

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
    preset_name,
    normalized_preset_code,
    preset_payment_type,
    preset_requires_reference,
    preset_sort_order
  )
  on conflict (organization_id, code) do nothing
  returning id into restored_method_id;

  if restored_method_id is null then
    select method.id
    into restored_method_id
    from public.payment_methods method
    where method.organization_id = target_organization_id
      and method.code = normalized_preset_code;

    return restored_method_id;
  end if;

  insert into public.store_payment_methods (
    organization_id,
    store_id,
    payment_method_id,
    is_enabled
  )
  select
    target_organization_id,
    requested.store_id,
    restored_method_id,
    true
  from unnest(target_store_ids) as requested(store_id);

  return restored_method_id;
end;
$$;

revoke execute on function public.create_store_scoped_payment_method(uuid, text, text, text, boolean, uuid[])
from public, anon, service_role;
revoke execute on function public.restore_tindio_payment_preset(uuid, text, uuid[])
from public, anon, service_role;
grant execute on function public.create_store_scoped_payment_method(uuid, text, text, text, boolean, uuid[])
to authenticated;
grant execute on function public.restore_tindio_payment_preset(uuid, text, uuid[])
to authenticated;

comment on function public.restore_tindio_payment_preset(uuid, text, uuid[])
is 'Restores one missing canonical TINDIO payment method to selected active stores without duplicating an existing preset.';

notify pgrst, 'reload schema';

commit;
