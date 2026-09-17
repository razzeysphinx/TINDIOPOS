begin;

-- Reserve the immutable operation document before locking or changing stock.
-- A concurrent exact retry blocks on the unique operation key and then
-- recovers the committed movement instead of surfacing a unique violation.
create or replace function private.post_inventory_adjustment(
  target_organization_id uuid,
  target_store_id uuid,
  target_product_id uuid,
  target_variant_id uuid,
  target_quantity_delta numeric,
  target_reason_code text,
  target_note text,
  target_operation_id uuid,
  target_actor_employee_id uuid,
  target_import_batch_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  selected_reason public.inventory_adjustment_reasons%rowtype;
  existing_adjustment public.inventory_adjustments%rowtype;
  adjustment_id uuid;
  created_adjustment_number bigint;
  movement_id uuid;
  current_quantity numeric(14,3);
  quantity_before numeric(14,3);
  quantity_after numeric(14,3);
  resolved_note text;
begin
  if target_operation_id is null then
    raise exception 'An adjustment operation identity is required.' using errcode = '23514';
  end if;

  if target_quantity_delta is null or target_quantity_delta = 0
    or target_quantity_delta <> round(target_quantity_delta, 3) then
    raise exception 'Adjustment quantity must be non-zero with at most three decimal places.' using errcode = '23514';
  end if;

  resolved_note := nullif(btrim(coalesce(target_note, '')), '');
  if char_length(coalesce(resolved_note, '')) not between 2 and 500 then
    raise exception 'Provide an adjustment explanation between 2 and 500 characters.' using errcode = '23514';
  end if;

  select reason.* into selected_reason
  from public.inventory_adjustment_reasons reason
  where reason.organization_id = target_organization_id
    and reason.code = upper(btrim(coalesce(target_reason_code, '')))
    and reason.is_active;
  if selected_reason.id is null then
    raise exception 'Choose an active adjustment reason.' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.products product
    join public.product_store_settings setting
      on setting.organization_id = product.organization_id
     and setting.product_id = product.id
     and setting.store_id = target_store_id
     and setting.is_available
    where product.id = target_product_id
      and product.organization_id = target_organization_id
      and product.status = 'active'
      and product.track_inventory
      and (
        (product.product_type = 'simple' and target_variant_id is null)
        or (product.product_type = 'variable' and target_variant_id is not null and exists (
          select 1 from public.product_variants variant
          where variant.id = target_variant_id
            and variant.product_id = product.id
            and variant.organization_id = product.organization_id
            and variant.is_active
        ))
      )
  ) then
    raise exception 'Choose an active inventory-tracked item or variant available in this store.' using errcode = '23514';
  end if;

  insert into public.inventory_adjustments (
    organization_id, store_id, product_id, variant_id, quantity_delta, reason_code,
    note, operation_id, import_batch_id, created_by_employee_id
  ) values (
    target_organization_id, target_store_id, target_product_id, target_variant_id,
    target_quantity_delta, selected_reason.code, resolved_note, target_operation_id,
    target_import_batch_id, target_actor_employee_id
  )
  on conflict (organization_id, operation_id) do nothing
  returning id, adjustment_number into adjustment_id, created_adjustment_number;

  if adjustment_id is null then
    select adjustment.* into existing_adjustment
    from public.inventory_adjustments adjustment
    where adjustment.organization_id = target_organization_id
      and adjustment.operation_id = target_operation_id
    for key share;

    if existing_adjustment.id is null then
      raise exception 'The adjustment operation could not be recovered.' using errcode = 'P0002';
    end if;
    if existing_adjustment.store_id <> target_store_id
      or existing_adjustment.product_id <> target_product_id
      or existing_adjustment.variant_id is distinct from target_variant_id
      or existing_adjustment.quantity_delta <> target_quantity_delta
      or existing_adjustment.reason_code <> selected_reason.code
      or existing_adjustment.note is distinct from resolved_note
      or existing_adjustment.import_batch_id is distinct from target_import_batch_id then
      raise exception 'This adjustment operation identity was already used for different details.' using errcode = '23505';
    end if;

    select movement.id into movement_id
    from public.inventory_movements movement
    where movement.organization_id = target_organization_id
      and movement.source_type = 'inventory_adjustment'
      and movement.source_id = existing_adjustment.id;
    if movement_id is null then
      raise exception 'The existing adjustment is missing its inventory movement.' using errcode = 'P0002';
    end if;
    return movement_id;
  end if;

  if selected_reason.movement_type = 'OPENING_STOCK' then
    select level.quantity into current_quantity
    from public.inventory_levels level
    where level.organization_id = target_organization_id
      and level.store_id = target_store_id
      and level.product_id = target_product_id
      and level.variant_id is not distinct from target_variant_id
    for update;

    if current_quantity is null or current_quantity <> 0 or exists (
      select 1 from public.inventory_movements movement
      where movement.organization_id = target_organization_id
        and movement.store_id = target_store_id
        and movement.product_id = target_product_id
        and movement.variant_id is not distinct from target_variant_id
    ) then
      raise exception 'Opening stock can only be recorded once for an item with no prior movement.' using errcode = '23514';
    end if;
  end if;

  perform private.apply_inventory_change_v2(
    target_organization_id, target_store_id, target_product_id, target_variant_id,
    target_quantity_delta, selected_reason.movement_type, target_actor_employee_id,
    resolved_note, 'inventory_adjustment', adjustment_id, null, selected_reason.code
  );

  select movement.id, movement.quantity_before, movement.quantity_after
  into movement_id, quantity_before, quantity_after
  from public.inventory_movements movement
  where movement.organization_id = target_organization_id
    and movement.source_type = 'inventory_adjustment'
    and movement.source_id = adjustment_id;
  if movement_id is null then
    raise exception 'The adjustment movement was not recorded.' using errcode = 'P0002';
  end if;

  perform private.write_audit_log(
    target_organization_id, 'INVENTORY_ADJUSTED', 'inventory.adjust',
    target_actor_employee_id, null, target_store_id, null, null, null, resolved_note,
    jsonb_build_object(
      'adjustment_id', adjustment_id, 'adjustment_number', created_adjustment_number,
      'operation_id', target_operation_id, 'import_batch_id', target_import_batch_id,
      'reason_code', selected_reason.code, 'movement_type', selected_reason.movement_type,
      'quantity_before', quantity_before, 'quantity_delta', target_quantity_delta,
      'quantity_after', quantity_after
    )
  );
  return movement_id;
end;
$function$;

revoke all on function private.post_inventory_adjustment(uuid,uuid,uuid,uuid,numeric,text,text,uuid,uuid,uuid)
from public, anon, authenticated, service_role;

comment on function private.post_inventory_adjustment(uuid,uuid,uuid,uuid,numeric,text,text,uuid,uuid,uuid) is
  'Canonical immutable adjustment posting core. Operation reservation makes exact concurrent retries replay-safe; opening stock remains restricted to an untouched zero-quantity position.';

comment on function public.record_inventory_adjustment_v3(uuid,uuid,uuid,numeric,text,text,uuid,uuid,uuid) is
  'Canonical controlled replay-safe inventory adjustment API for opening stock and signed manual corrections, with optional approval and variant.';

-- Keep forensic compatibility definitions, but prove they remain unavailable
-- to every application-facing role.
revoke all on function private.adjust_inventory(uuid,uuid,uuid,uuid,numeric,text,text) from public, anon, authenticated, service_role;
revoke all on function public.adjust_inventory(uuid,uuid,uuid,uuid,numeric,text,text,uuid) from public, anon, authenticated, service_role;
revoke all on function private.record_inventory_adjustment_v2(uuid,uuid,uuid,uuid,numeric,text,text) from public, anon, authenticated, service_role;
revoke all on function public.record_inventory_adjustment_v2(uuid,uuid,uuid,uuid,numeric,text,text) from public, anon, authenticated, service_role;
revoke all on function private.import_inventory_adjustments_csv(uuid,uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.import_inventory_adjustments_csv(uuid,uuid,text,jsonb) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
