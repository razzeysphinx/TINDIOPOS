begin;

create table private.product_unit_operations (
  organization_id uuid not null references public.organizations (id) on delete restrict,
  operation_id uuid not null,
  command text not null check (command in ('create', 'update', 'delete')),
  normalized_payload jsonb not null,
  result_unit_id uuid not null,
  actor_profile_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, operation_id)
);

comment on table private.product_unit_operations is
  'Private replay registry for canonical product-unit administration commands.';

create or replace function private.protect_product_unit_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_base then
      raise exception 'The base unit cannot be deleted.' using errcode = '23514';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' and new.is_base then
    if new.factor_to_base <> 1
       or new.unit_code is distinct from (
         select product.unit from public.products product
         where product.id = new.product_id
           and product.organization_id = new.organization_id
       ) then
      raise exception 'A base unit must match the product stock unit with factor 1.' using errcode = '23514';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id
       or new.product_id is distinct from old.product_id
       or new.is_base is distinct from old.is_base then
      raise exception 'A product unit cannot change product, organization, or base identity.' using errcode = '23514';
    end if;
    if old.is_base and (
      new.unit_code is distinct from old.unit_code
      or new.factor_to_base is distinct from old.factor_to_base
    ) then
      raise exception 'The base unit code and conversion factor are immutable.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists product_units_protect_identity on public.product_units;
create trigger product_units_protect_identity
before insert or update or delete on public.product_units
for each row execute function private.protect_product_unit_identity();

create or replace function private.claim_product_unit_operation(
  target_organization_id uuid,
  target_operation_id uuid,
  target_command text,
  target_payload jsonb,
  target_result_unit_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing private.product_unit_operations%rowtype;
begin
  if target_operation_id is null then
    raise exception 'A stable product-unit operation ID is required.' using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_organization_id::text || ':product-unit-operation:' || target_operation_id::text, 0)
  );

  select operation.* into existing
  from private.product_unit_operations operation
  where operation.organization_id = target_organization_id
    and operation.operation_id = target_operation_id;

  if found then
    if existing.command <> target_command or existing.normalized_payload <> target_payload then
      raise exception 'This operation ID is already assigned to a different product-unit command.' using errcode = '23505';
    end if;
    return existing.result_unit_id;
  end if;

  insert into private.product_unit_operations (
    organization_id, operation_id, command, normalized_payload, result_unit_id, actor_profile_id
  ) values (
    target_organization_id, target_operation_id, target_command, target_payload,
    target_result_unit_id, (select auth.uid())
  );
  return null;
end;
$$;

create or replace function public.create_product_unit(
  target_organization_id uuid,
  target_product_id uuid,
  target_unit_code text,
  target_unit_name text,
  target_factor_to_base numeric,
  target_is_sale_unit boolean,
  target_is_purchase_unit boolean,
  target_operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_code text := lower(btrim(target_unit_code));
  normalized_name text := btrim(target_unit_name);
  payload jsonb;
  unit_id uuid := gen_random_uuid();
  replay_id uuid;
  actor_employee_id uuid;
begin
  if (select auth.uid()) is null
     or not (select private.has_permission(target_organization_id, 'products.manage')) then
    raise exception 'Product management permission is required.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.products product
    where product.id = target_product_id and product.organization_id = target_organization_id
  ) then
    raise exception 'The product could not be found.' using errcode = '23503';
  end if;

  payload := jsonb_build_object(
    'product_id', target_product_id, 'unit_code', normalized_code,
    'unit_name', normalized_name, 'factor_to_base', target_factor_to_base,
    'is_sale_unit', target_is_sale_unit, 'is_purchase_unit', target_is_purchase_unit
  );
  replay_id := private.claim_product_unit_operation(
    target_organization_id, target_operation_id, 'create', payload, unit_id
  );
  if replay_id is not null then return replay_id; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_organization_id::text || ':' || target_product_id::text || ':product-unit:' || normalized_code, 0)
  );
  if exists (
    select 1 from public.product_units unit
    where unit.product_id = target_product_id and unit.unit_code = normalized_code
  ) then
    raise exception 'This unit code already exists for the product.' using errcode = '23505';
  end if;

  insert into public.product_units (
    id, organization_id, product_id, unit_code, unit_name, factor_to_base,
    is_base, is_sale_unit, is_purchase_unit
  ) values (
    unit_id, target_organization_id, target_product_id, normalized_code, normalized_name,
    target_factor_to_base, false, coalesce(target_is_sale_unit, false), coalesce(target_is_purchase_unit, false)
  );

  actor_employee_id := private.current_employee_id(target_organization_id);
  perform private.write_audit_log(
    target_organization_id, 'PRODUCT_UNIT_CREATED', 'products.manage', actor_employee_id,
    null, null, null, null, null, null,
    jsonb_build_object('product_id', target_product_id, 'unit_id', unit_id,
      'operation_id', target_operation_id, 'old_values', null, 'new_values', payload)
  );
  return unit_id;
end;
$$;

create or replace function public.update_product_unit(
  target_organization_id uuid,
  target_unit_id uuid,
  target_unit_code text,
  target_unit_name text,
  target_factor_to_base numeric,
  target_is_sale_unit boolean,
  target_is_purchase_unit boolean,
  target_operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_unit public.product_units%rowtype;
  normalized_code text := lower(btrim(target_unit_code));
  normalized_name text := btrim(target_unit_name);
  payload jsonb;
  replay_id uuid;
  old_values jsonb;
  actor_employee_id uuid;
begin
  if (select auth.uid()) is null
     or not (select private.has_permission(target_organization_id, 'products.manage')) then
    raise exception 'Product management permission is required.' using errcode = '42501';
  end if;

  payload := jsonb_build_object(
    'unit_id', target_unit_id, 'unit_code', normalized_code, 'unit_name', normalized_name,
    'factor_to_base', target_factor_to_base, 'is_sale_unit', target_is_sale_unit,
    'is_purchase_unit', target_is_purchase_unit
  );
  replay_id := private.claim_product_unit_operation(
    target_organization_id, target_operation_id, 'update', payload, target_unit_id
  );
  if replay_id is not null then return replay_id; end if;

  select unit.* into current_unit
  from public.product_units unit
  where unit.id = target_unit_id and unit.organization_id = target_organization_id
  for update;
  if not found then raise exception 'The product unit could not be found.' using errcode = '23503'; end if;

  old_values := jsonb_build_object(
    'unit_code', current_unit.unit_code, 'unit_name', current_unit.unit_name,
    'factor_to_base', current_unit.factor_to_base, 'is_sale_unit', current_unit.is_sale_unit,
    'is_purchase_unit', current_unit.is_purchase_unit
  );
  if current_unit.is_base and (
    normalized_code is distinct from current_unit.unit_code
    or target_factor_to_base is distinct from current_unit.factor_to_base
  ) then
    raise exception 'The base unit code and conversion factor are immutable.' using errcode = '23514';
  end if;

  update public.product_units
  set unit_code = normalized_code, unit_name = normalized_name,
      factor_to_base = target_factor_to_base,
      is_sale_unit = coalesce(target_is_sale_unit, false),
      is_purchase_unit = coalesce(target_is_purchase_unit, false)
  where id = target_unit_id;

  actor_employee_id := private.current_employee_id(target_organization_id);
  perform private.write_audit_log(
    target_organization_id, 'PRODUCT_UNIT_UPDATED', 'products.manage', actor_employee_id,
    null, null, null, null, null, null,
    jsonb_build_object('product_id', current_unit.product_id, 'unit_id', target_unit_id,
      'operation_id', target_operation_id, 'old_values', old_values, 'new_values', payload - 'unit_id')
  );
  return target_unit_id;
end;
$$;

create or replace function public.delete_product_unit(
  target_organization_id uuid,
  target_unit_id uuid,
  target_operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_unit public.product_units%rowtype;
  payload jsonb := jsonb_build_object('unit_id', target_unit_id);
  replay_id uuid;
  old_values jsonb;
  actor_employee_id uuid;
begin
  if (select auth.uid()) is null
     or not (select private.has_permission(target_organization_id, 'products.manage')) then
    raise exception 'Product management permission is required.' using errcode = '42501';
  end if;
  replay_id := private.claim_product_unit_operation(
    target_organization_id, target_operation_id, 'delete', payload, target_unit_id
  );
  if replay_id is not null then return replay_id; end if;

  select unit.* into current_unit
  from public.product_units unit
  where unit.id = target_unit_id and unit.organization_id = target_organization_id
  for update;
  if not found then raise exception 'The product unit could not be found.' using errcode = '23503'; end if;
  if current_unit.is_base then raise exception 'The base unit cannot be deleted.' using errcode = '23514'; end if;

  old_values := jsonb_build_object(
    'unit_code', current_unit.unit_code, 'unit_name', current_unit.unit_name,
    'factor_to_base', current_unit.factor_to_base, 'is_sale_unit', current_unit.is_sale_unit,
    'is_purchase_unit', current_unit.is_purchase_unit
  );
  delete from public.product_units where id = target_unit_id;

  actor_employee_id := private.current_employee_id(target_organization_id);
  perform private.write_audit_log(
    target_organization_id, 'PRODUCT_UNIT_DELETED', 'products.manage', actor_employee_id,
    null, null, null, null, null, null,
    jsonb_build_object('product_id', current_unit.product_id, 'unit_id', target_unit_id,
      'operation_id', target_operation_id, 'old_values', old_values, 'new_values', null)
  );
  return target_unit_id;
end;
$$;

revoke execute on function private.protect_product_unit_identity() from public, anon, authenticated, service_role;
revoke execute on function private.claim_product_unit_operation(uuid,uuid,text,jsonb,uuid) from public, anon, authenticated, service_role;

revoke all on function public.create_product_unit(uuid,uuid,text,text,numeric,boolean,boolean,uuid) from public, anon, service_role;
revoke all on function public.update_product_unit(uuid,uuid,text,text,numeric,boolean,boolean,uuid) from public, anon, service_role;
revoke all on function public.delete_product_unit(uuid,uuid,uuid) from public, anon, service_role;
grant execute on function public.create_product_unit(uuid,uuid,text,text,numeric,boolean,boolean,uuid) to authenticated;
grant execute on function public.update_product_unit(uuid,uuid,text,text,numeric,boolean,boolean,uuid) to authenticated;
grant execute on function public.delete_product_unit(uuid,uuid,uuid) to authenticated;

revoke insert, update, delete on public.product_units from authenticated;
grant select on public.product_units to authenticated;

comment on function public.create_product_unit(uuid,uuid,text,text,numeric,boolean,boolean,uuid) is
  'Canonical, permission-gated, replay-safe creation of a non-base per-product unit.';
comment on function public.update_product_unit(uuid,uuid,text,text,numeric,boolean,boolean,uuid) is
  'Canonical, audited update. Base code/factor remain immutable; transaction snapshots are never rewritten.';
comment on function public.delete_product_unit(uuid,uuid,uuid) is
  'Canonical hard deletion of non-base unit configuration. Historical PO/receipt evidence remains in immutable snapshots.';

commit;
