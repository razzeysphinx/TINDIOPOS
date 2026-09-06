-- Phase 4: inventory-count reconciliation under concurrent inventory activity.
--
-- A count-start expected quantity remains an immutable audit snapshot.  When a
-- physical quantity is saved, the current inventory projection is locked and
-- captured separately as the reconciled expected quantity.  Posting applies
-- only the variance against that reconciliation point, so sales, receiving,
-- and transfers that occur during (or after) the count are never posted twice.
begin;

alter table public.inventory_count_lines
  add column if not exists reconciled_expected_quantity numeric(14,3),
  add column if not exists counted_at timestamptz;

-- Historical count lines were saved before reconciliation was explicit.  Their
-- saved expected quantity was the value the prior workflow used at posting;
-- preserve that historical meaning rather than rewriting past stock records.
update public.inventory_count_lines line
set reconciled_expected_quantity = line.expected_quantity,
    counted_at = coalesce(count_document.completed_at, count_document.updated_at, count_document.started_at)
from public.inventory_counts count_document
where count_document.id = line.inventory_count_id
  and count_document.organization_id = line.organization_id
  and line.counted_quantity is not null
  and (line.reconciled_expected_quantity is null or line.counted_at is null);

alter table public.inventory_count_lines
  drop constraint if exists inventory_count_lines_reconciliation_state_valid,
  add constraint inventory_count_lines_reconciliation_state_valid check (
    (counted_quantity is null and reconciled_expected_quantity is null and counted_at is null)
    or
    (counted_quantity is not null and reconciled_expected_quantity is not null and counted_at is not null)
  );

create index if not exists inventory_count_lines_reconciliation_lookup_idx
  on public.inventory_count_lines (inventory_count_id, product_id, variant_id);

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
as $function$
declare
  count_document public.inventory_counts%rowtype;
  actor_id uuid;
  current_reconciled_expected_quantity numeric(14,3);
  existing_line_id uuid;
  product_snapshot record;
  next_line_sort_order integer;
  recorded_at timestamptz;
begin
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

  -- This is the shared count permission and store-scope boundary used by
  -- count preparation, review, and posting.  It intentionally supports
  -- inventory.count as well as inventory.manage; it does not use role names.
  actor_id := private.inventory_count_actor(target_organization_id, count_document.store_id);

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
    and product.status = 'active'
    and product.track_inventory
    and (
      (product.product_type = 'variable' and target_variant_id is not null and variant.id is not null and variant.is_active)
      or
      (product.product_type <> 'variable' and target_variant_id is null)
    );

  if not found then
    raise exception 'Choose an active inventory-tracked item that belongs to this business.' using errcode = '23503';
  end if;

  if not exists (
    select 1
    from public.product_store_settings setting
    where setting.organization_id = target_organization_id
      and setting.store_id = count_document.store_id
      and setting.product_id = target_product_id
  ) then
    raise exception 'Choose an item assigned to this store.' using errcode = '23503';
  end if;

  -- Every canonical inventory movement locks this same projection row.  By
  -- reading it FOR UPDATE at the moment the physical quantity is saved, this
  -- value is the authoritative expected quantity at the count line's exact
  -- reconciliation point, not a stale count-start snapshot.
  select level.quantity into current_reconciled_expected_quantity
  from public.inventory_levels level
  where level.organization_id = target_organization_id
    and level.store_id = count_document.store_id
    and level.product_id = target_product_id
    and level.variant_id is not distinct from target_variant_id
  for update;

  if not found then
    raise exception 'The stock projection is not initialized for this item and store.' using errcode = '23514';
  end if;

  recorded_at := clock_timestamp();

  select line.id into existing_line_id
  from public.inventory_count_lines line
  where line.organization_id = target_organization_id
    and line.inventory_count_id = target_inventory_count_id
    and line.product_id = target_product_id
    and line.variant_id is not distinct from target_variant_id
  for update;

  if existing_line_id is null then
    select coalesce(max(line.line_sort_order) + 1, 0)
    into next_line_sort_order
    from public.inventory_count_lines line
    where line.organization_id = target_organization_id
      and line.inventory_count_id = target_inventory_count_id;

    insert into public.inventory_count_lines (
      organization_id,
      inventory_count_id,
      product_id,
      variant_id,
      expected_quantity,
      reconciled_expected_quantity,
      counted_quantity,
      counted_at,
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
      current_reconciled_expected_quantity,
      current_reconciled_expected_quantity,
      target_counted_quantity,
      recorded_at,
      product_snapshot.product_name,
      product_snapshot.variant_name,
      product_snapshot.category_name,
      product_snapshot.sku,
      product_snapshot.barcode,
      product_snapshot.unit,
      next_line_sort_order
    );
  else
    -- Prepared lines retain their count-start expected snapshot forever.  A
    -- corrected physical quantity receives a new reconciliation point instead
    -- of rewriting the original snapshot.
    update public.inventory_count_lines
    set counted_quantity = target_counted_quantity,
        reconciled_expected_quantity = current_reconciled_expected_quantity,
        counted_at = recorded_at
    where id = existing_line_id;
  end if;

  update public.inventory_counts
  set status = 'in_progress', updated_at = recorded_at
  where id = target_inventory_count_id;
end;
$function$;

create or replace function private.post_inventory_count(
  target_organization_id uuid,
  target_inventory_count_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  count_document public.inventory_counts%rowtype;
  actor_id uuid;
  line public.inventory_count_lines%rowtype;
  variance numeric(14,3);
  posted_line_count integer := 0;
  total_variance numeric(14,3) := 0;
begin
  select count_row.* into count_document
  from public.inventory_counts count_row
  where count_row.id = target_inventory_count_id
    and count_row.organization_id = target_organization_id
  for update;

  if count_document.id is null or count_document.status <> 'ready_for_review' then
    raise exception 'Only a reviewed inventory count can be posted.' using errcode = '23514';
  end if;

  actor_id := private.inventory_count_actor(target_organization_id, count_document.store_id);

  for line in
    select saved_line.*
    from public.inventory_count_lines saved_line
    where saved_line.organization_id = target_organization_id
      and saved_line.inventory_count_id = target_inventory_count_id
    order by saved_line.line_sort_order, saved_line.id
  loop
    if line.counted_quantity is null
      or line.reconciled_expected_quantity is null
      or line.counted_at is null then
      raise exception 'Every prepared item must be counted and reconciled before posting.' using errcode = '23514';
    end if;

    -- The stored reconciled expected quantity was captured under the same
    -- inventory-level row lock used by sales, receipts, transfers, and other
    -- canonical movements.  Movements after this line was counted remain in
    -- the live projection; only this measured variance is added at posting.
    variance := line.counted_quantity - line.reconciled_expected_quantity;
    total_variance := total_variance + variance;
    posted_line_count := posted_line_count + 1;

    if variance <> 0 then
      perform private.apply_inventory_change_v2(
        target_organization_id,
        count_document.store_id,
        line.product_id,
        line.variant_id,
        variance,
        'COUNT',
        actor_id,
        'Inventory count variance posted',
        'inventory_count',
        count_document.id,
        null,
        'COUNT_VARIANCE'
      );
    end if;
  end loop;

  update public.inventory_counts
  set status = 'posted',
      completed_by_employee_id = actor_id,
      completed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = target_inventory_count_id;

  perform private.write_audit_log(
    target_organization_id,
    'INVENTORY_COUNT_POSTED',
    'inventory.count',
    actor_id,
    null,
    count_document.store_id,
    null,
    null,
    null,
    count_document.note,
    jsonb_build_object(
      'inventory_count_id', count_document.id,
      'count_number', count_document.count_number,
      'line_count', posted_line_count,
      'reconciled_variance', total_variance
    )
  );
end;
$function$;

revoke execute on function private.save_inventory_count_line(uuid, uuid, uuid, uuid, numeric) from public, anon, service_role;
grant execute on function private.save_inventory_count_line(uuid, uuid, uuid, uuid, numeric) to authenticated;
revoke execute on function private.post_inventory_count(uuid, uuid) from public, anon, service_role;
grant execute on function private.post_inventory_count(uuid, uuid) to authenticated;

comment on column public.inventory_count_lines.expected_quantity is
  'Immutable inventory projection snapshot captured when the count line was prepared.';
comment on column public.inventory_count_lines.reconciled_expected_quantity is
  'Authoritative inventory projection captured under lock when the physical count was saved.';
comment on column public.inventory_count_lines.counted_at is
  'Time the physical quantity and reconciled expected projection were recorded.';
comment on function private.post_inventory_count(uuid, uuid) is
  'Posts only count variance against the line reconciliation point so concurrent ledger movements remain intact.';

commit;
