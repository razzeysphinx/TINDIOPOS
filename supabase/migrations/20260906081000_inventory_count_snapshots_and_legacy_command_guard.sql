-- Preserve the current document-based inventory-count flow after snapshot
-- columns became mandatory, and close two retained, non-idempotent legacy
-- stock-changing RPC routes. The legacy source remains for migration
-- compatibility, but application roles cannot invoke it.
begin;

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
  product_snapshot record;
  next_line_sort_order integer;
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

  select
    product.name as product_name,
    case when target_variant_id is null then null else variant.name end as variant_name,
    coalesce(category.name, 'Uncategorized') as category_name,
    coalesce(case when target_variant_id is null then null else variant.sku end, product.sku) as sku,
    coalesce(case when target_variant_id is null then null else variant.barcode end, product.barcode) as barcode,
    product.unit as unit
  into product_snapshot
  from public.products product
  left join public.product_variants variant
    on variant.id = target_variant_id
    and variant.product_id = product.id
    and variant.organization_id = product.organization_id
  left join public.categories category
    on category.id = product.category_id
    and category.organization_id = product.organization_id
  where product.id = target_product_id
    and product.organization_id = target_organization_id
    and (target_variant_id is null or variant.id is not null);

  if not found then
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
    select coalesce(max(line_sort_order) + 1, 0)
    into next_line_sort_order
    from public.inventory_count_lines
    where organization_id = target_organization_id
      and inventory_count_id = target_inventory_count_id;

    insert into public.inventory_count_lines (
      organization_id,
      inventory_count_id,
      product_id,
      variant_id,
      expected_quantity,
      counted_quantity,
      product_name_snapshot,
      variant_name_snapshot,
      category_name_snapshot,
      sku_snapshot,
      barcode_snapshot,
      unit_snapshot,
      line_sort_order
    ) values (
      target_organization_id,
      target_inventory_count_id,
      target_product_id,
      target_variant_id,
      level_expected_quantity,
      target_counted_quantity,
      product_snapshot.product_name,
      product_snapshot.variant_name,
      product_snapshot.category_name,
      product_snapshot.sku,
      product_snapshot.barcode,
      product_snapshot.unit,
      next_line_sort_order
    );
  else
    -- A saved count is historical. Do not rewrite its item identity snapshot
    -- when the user corrects the counted quantity before review.
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

revoke execute on function private.complete_inventory_count(uuid, uuid, text, jsonb) from authenticated;
revoke execute on function public.complete_inventory_count(uuid, uuid, text, jsonb) from authenticated;
revoke execute on function private.transfer_stock(uuid, uuid, uuid, jsonb, text) from authenticated;
revoke execute on function public.transfer_stock(uuid, uuid, uuid, jsonb, text) from authenticated;

comment on function public.complete_inventory_count(uuid, uuid, text, jsonb) is
  'CANDIDATE_FOR_REMOVAL: retained legacy one-step count API. Application roles use the draft, review, and post inventory-count lifecycle.';
comment on function public.transfer_stock(uuid, uuid, uuid, jsonb, text) is
  'CANDIDATE_FOR_REMOVAL: retained legacy immediate-transfer API. Application roles use the request, approval, dispatch, and receipt lifecycle.';

commit;
