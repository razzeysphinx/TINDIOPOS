-- Stabilization correction for the applied inventory document lifecycle.
--
-- Keep the RPC contracts and authorization boundaries unchanged.  The local
-- variable names below deliberately cannot collide with returned/table column
-- names, because PL/pgSQL otherwise rejects the statements at execution time.

create or replace function private.record_inventory_adjustment_v2(
  target_organization_id uuid,
  target_store_id uuid,
  target_product_id uuid,
  target_variant_id uuid,
  target_quantity_delta numeric,
  target_reason_code text,
  target_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  selected_reason public.inventory_adjustment_reasons%rowtype;
  adjustment_id uuid;
  created_adjustment_number bigint;
  movement_id uuid;
  resolved_note text;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'inventory.manage')) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;
  if target_quantity_delta = 0 then
    raise exception 'Adjustment quantity must not be zero.' using errcode = '23514';
  end if;

  actor_id := private.inventory_actor(target_organization_id, target_store_id);
  if actor_id is null then
    raise exception 'An assigned employee is required for this store.' using errcode = '42501';
  end if;

  select reason.* into selected_reason
  from public.inventory_adjustment_reasons reason
  where reason.organization_id = target_organization_id
    and reason.code = upper(btrim(coalesce(target_reason_code, '')))
    and reason.is_active;
  if selected_reason.id is null then
    raise exception 'Choose an active adjustment reason.' using errcode = '23514';
  end if;

  resolved_note := coalesce(nullif(btrim(target_note), ''), selected_reason.name);
  insert into public.inventory_adjustments (
    organization_id, store_id, product_id, variant_id, quantity_delta,
    reason_code, note, created_by_employee_id
  ) values (
    target_organization_id, target_store_id, target_product_id, target_variant_id,
    target_quantity_delta, selected_reason.code, resolved_note, actor_id
  ) returning id, adjustment_number into adjustment_id, created_adjustment_number;

  perform private.apply_inventory_change_v2(
    target_organization_id, target_store_id, target_product_id, target_variant_id,
    target_quantity_delta, selected_reason.movement_type, actor_id, resolved_note,
    'inventory_adjustment', adjustment_id, null, selected_reason.code
  );

  select movement.id into movement_id
  from public.inventory_movements movement
  where movement.organization_id = target_organization_id
    and movement.source_type = 'inventory_adjustment'
    and movement.source_id = adjustment_id;

  perform private.write_audit_log(
    target_organization_id, 'INVENTORY_ADJUSTED', 'inventory.adjust', actor_id,
    null, target_store_id, null, null, null, resolved_note,
    jsonb_build_object(
      'adjustment_id', adjustment_id,
      'adjustment_number', created_adjustment_number,
      'reason_code', selected_reason.code,
      'quantity_delta', target_quantity_delta
    )
  );
  return movement_id;
end;
$$;

create or replace function private.create_inventory_count_draft(
  target_organization_id uuid,
  target_store_id uuid,
  target_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  count_id uuid;
  created_count_number bigint;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'inventory.manage')) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.stores store
    where store.id = target_store_id
      and store.organization_id = target_organization_id
      and store.is_active
  ) then
    raise exception 'Choose an active store.' using errcode = '23514';
  end if;
  actor_id := private.inventory_actor(target_organization_id, target_store_id);
  if actor_id is null then
    raise exception 'An assigned employee is required for this store.' using errcode = '42501';
  end if;

  insert into public.inventory_counts (organization_id, store_id, status, note, started_by_employee_id)
  values (target_organization_id, target_store_id, 'draft', nullif(btrim(target_note), ''), actor_id)
  returning id, count_number into count_id, created_count_number;

  perform private.write_audit_log(
    target_organization_id, 'INVENTORY_COUNT_DRAFT_CREATED', 'inventory.manage', actor_id,
    null, target_store_id, null, null, null, target_note,
    jsonb_build_object('inventory_count_id', count_id, 'count_number', created_count_number)
  );
  return count_id;
end;
$$;

create or replace function private.save_inventory_count_line(
  target_organization_id uuid,
  target_inventory_count_id uuid,
  target_product_id uuid,
  target_variant_id uuid,
  target_counted_quantity numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  count_document public.inventory_counts%rowtype;
  actor_id uuid;
  level_expected_quantity numeric(14,3);
  existing_line_id uuid;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'inventory.manage')) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;
  if target_counted_quantity < 0 then
    raise exception 'Counted quantity must be zero or greater.' using errcode = '23514';
  end if;

  select count_row.* into count_document
  from public.inventory_counts count_row
  where count_row.id = target_inventory_count_id
    and count_row.organization_id = target_organization_id
  for update;
  if count_document.id is null then
    raise exception 'Inventory count was not found.' using errcode = '23503';
  end if;
  if count_document.status not in ('draft', 'in_progress') then
    raise exception 'Only draft or in-progress counts can be edited.' using errcode = '23514';
  end if;

  actor_id := private.inventory_actor(target_organization_id, count_document.store_id);
  if actor_id is null then
    raise exception 'An assigned employee is required for this store.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.products product
    where product.id = target_product_id
      and product.organization_id = target_organization_id
  ) or (target_variant_id is not null and not exists (
    select 1 from public.product_variants variant
    where variant.id = target_variant_id
      and variant.product_id = target_product_id
      and variant.organization_id = target_organization_id
  )) then
    raise exception 'Choose an item that belongs to this business.' using errcode = '23503';
  end if;

  select level.quantity into level_expected_quantity
  from public.inventory_levels level
  where level.organization_id = target_organization_id
    and level.store_id = count_document.store_id
    and level.product_id = target_product_id
    and level.variant_id is not distinct from target_variant_id
  for update;
  if not found then
    raise exception 'The stock projection is not initialized for this item and store.' using errcode = '23514';
  end if;

  select line.id into existing_line_id
  from public.inventory_count_lines line
  where line.organization_id = target_organization_id
    and line.inventory_count_id = target_inventory_count_id
    and line.product_id = target_product_id
    and line.variant_id is not distinct from target_variant_id
  for update;

  if existing_line_id is null then
    insert into public.inventory_count_lines (
      organization_id, inventory_count_id, product_id, variant_id, expected_quantity, counted_quantity
    ) values (
      target_organization_id, target_inventory_count_id, target_product_id, target_variant_id,
      level_expected_quantity, target_counted_quantity
    );
  else
    update public.inventory_count_lines
    set expected_quantity = level_expected_quantity,
        counted_quantity = target_counted_quantity
    where id = existing_line_id;
  end if;

  update public.inventory_counts
  set status = 'in_progress', updated_at = now()
  where id = target_inventory_count_id;
end;
$$;
