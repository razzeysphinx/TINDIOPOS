begin;

drop function if exists public.return_to_supplier(uuid,uuid,uuid,jsonb,text);
drop function if exists private.return_to_supplier(uuid,uuid,uuid,jsonb,text);

create or replace function private.guard_supplier_return_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Posted supplier-return evidence is immutable.' using errcode = '55000';
end;
$$;

drop trigger if exists supplier_returns_guard_immutable on public.supplier_returns;
create trigger supplier_returns_guard_immutable
before update or delete on public.supplier_returns
for each row execute function private.guard_supplier_return_evidence();

drop trigger if exists supplier_return_lines_guard_immutable on public.supplier_return_lines;
create trigger supplier_return_lines_guard_immutable
before update or delete on public.supplier_return_lines
for each row execute function private.guard_supplier_return_evidence();

create or replace function private.return_to_supplier(
  target_organization_id uuid,
  target_store_id uuid,
  target_supplier_id uuid,
  target_lines jsonb,
  target_note text,
  target_operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  return_id uuid;
  existing_return public.supplier_returns%rowtype;
  line jsonb;
  stock_level public.inventory_levels%rowtype;
  line_quantity numeric(14,3);
  normalized_note text;
  normalized_lines jsonb;
  persisted_lines jsonb;
begin
  if (select auth.uid()) is null
     or (
       not (select private.has_permission(target_organization_id, 'inventory.manage'))
       and not (select private.has_inventory_capability(target_organization_id, 'purchasing.return'))
     ) then
    raise exception 'Supplier-return permission is required.' using errcode = '42501';
  end if;
  if target_operation_id is null then
    raise exception 'An operation ID is required for a supplier return.' using errcode = '23514';
  end if;
  if target_lines is null
     or jsonb_typeof(target_lines) <> 'array'
     or jsonb_array_length(target_lines) not between 1 and 100 then
    raise exception 'A supplier return needs one to 100 items.' using errcode = '23514';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(target_lines) requested(line)
    where coalesce(requested.line->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or (
         nullif(requested.line->>'variant_id', '') is not null
         and requested.line->>'variant_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       )
       or coalesce(requested.line->>'quantity', '') !~ '^\d+(\.\d{1,3})?$'
       or (requested.line->>'quantity')::numeric <= 0
  ) then
    raise exception 'Supplier-return lines must include valid items and quantities.' using errcode = '23514';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'product_id', (requested.line->>'product_id')::uuid,
      'variant_id', nullif(requested.line->>'variant_id', '')::uuid,
      'quantity', (requested.line->>'quantity')::numeric(14,3)
    ) order by
      (requested.line->>'product_id')::uuid,
      nullif(requested.line->>'variant_id', '')::uuid nulls first
  )
  into normalized_lines
  from jsonb_array_elements(target_lines) requested(line);

  if jsonb_array_length(normalized_lines) <> (
    select count(*)
    from (
      select distinct
        requested.line->>'product_id',
        coalesce(requested.line->>'variant_id', '')
      from jsonb_array_elements(target_lines) requested(line)
    ) unique_lines
  ) then
    raise exception 'Each item can appear only once in a supplier return.' using errcode = '23514';
  end if;

  actor_id := private.inventory_actor(target_organization_id, target_store_id);
  if actor_id is null then
    raise exception 'An assigned employee is required for this store.' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.suppliers supplier
    where supplier.id = target_supplier_id
      and supplier.organization_id = target_organization_id
      and supplier.is_active
  ) then
    raise exception 'Choose an active supplier.' using errcode = '23514';
  end if;

  normalized_note := nullif(btrim(target_note), '');
  select supplier_return.* into existing_return
  from public.supplier_returns supplier_return
  where supplier_return.organization_id = target_organization_id
    and supplier_return.operation_id = target_operation_id;

  if found then
    select jsonb_agg(
      jsonb_build_object(
        'product_id', return_line.product_id,
        'variant_id', return_line.variant_id,
        'quantity', return_line.quantity
      ) order by return_line.product_id, return_line.variant_id nulls first
    )
    into persisted_lines
    from public.supplier_return_lines return_line
    where return_line.organization_id = target_organization_id
      and return_line.supplier_return_id = existing_return.id;

    if existing_return.store_id is distinct from target_store_id
       or existing_return.supplier_id is distinct from target_supplier_id
       or existing_return.note is distinct from normalized_note
       or persisted_lines is distinct from normalized_lines then
      raise exception 'This operation ID is already assigned to a different supplier-return payload.' using errcode = '23505';
    end if;
    return existing_return.id;
  end if;

  insert into public.supplier_returns (
    organization_id, supplier_id, store_id, returned_by_employee_id, note, operation_id
  ) values (
    target_organization_id, target_supplier_id, target_store_id, actor_id,
    normalized_note, target_operation_id
  ) returning id into return_id;

  for line in select value from jsonb_array_elements(normalized_lines)
  loop
    line_quantity := (line->>'quantity')::numeric(14,3);
    select level.* into stock_level
    from public.inventory_levels level
    where level.organization_id = target_organization_id
      and level.store_id = target_store_id
      and level.product_id = (line->>'product_id')::uuid
      and level.variant_id is not distinct from nullif(line->>'variant_id', '')::uuid
    for update;

    if stock_level.id is null or stock_level.quantity < line_quantity then
      raise exception 'Stock is insufficient for this supplier return.' using errcode = '23514';
    end if;

    insert into public.supplier_return_lines (
      organization_id, supplier_return_id, product_id, variant_id, quantity, unit_cost_minor
    ) values (
      target_organization_id, return_id, stock_level.product_id, stock_level.variant_id,
      line_quantity, stock_level.average_cost_minor
    );
    perform private.apply_inventory_change_v2(
      target_organization_id, target_store_id, stock_level.product_id, stock_level.variant_id,
      -line_quantity, 'SUPPLIER_RETURN', actor_id, 'Returned to supplier', 'supplier_return',
      return_id, stock_level.average_cost_minor
    );
  end loop;

  perform private.write_audit_log(
    target_organization_id, 'SUPPLIER_RETURN_CREATED', 'purchasing.return', actor_id,
    null, target_store_id, null, null, null, normalized_note,
    jsonb_build_object(
      'supplier_return_id', return_id,
      'supplier_id', target_supplier_id,
      'operation_id', target_operation_id,
      'lines', normalized_lines
    )
  );
  return return_id;
end;
$$;

create or replace function public.return_to_supplier(
  target_organization_id uuid,
  target_store_id uuid,
  target_supplier_id uuid,
  target_lines jsonb,
  target_note text,
  target_operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_operation_id is null then
    raise exception 'An operation ID is required for a supplier return.' using errcode = '23514';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_organization_id::text || ':supplier-return:' || target_operation_id::text,
      0
    )
  );
  return private.return_to_supplier(
    target_organization_id, target_store_id, target_supplier_id,
    target_lines, target_note, target_operation_id
  );
end;
$$;

revoke execute on function private.guard_supplier_return_evidence()
from public, anon, authenticated, service_role;
revoke all on function private.return_to_supplier(uuid,uuid,uuid,jsonb,text,uuid)
from public, anon, authenticated, service_role;
revoke all on function public.return_to_supplier(uuid,uuid,uuid,jsonb,text,uuid)
from public, anon, service_role;
grant execute on function public.return_to_supplier(uuid,uuid,uuid,jsonb,text,uuid)
to authenticated;

comment on function public.return_to_supplier(uuid,uuid,uuid,jsonb,text,uuid) is
  'Canonical serialized supplier-return command. Exact replay compares the immutable normalized header and complete line payload.';
comment on function private.return_to_supplier(uuid,uuid,uuid,jsonb,text,uuid) is
  'Private supplier-return mutation engine. Application roles must use the canonical public command.';
comment on function private.guard_supplier_return_evidence() is
  'Prevents mutation or deletion of posted supplier-return header and line evidence.';

commit;
