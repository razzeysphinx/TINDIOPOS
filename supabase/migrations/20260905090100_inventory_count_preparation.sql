begin;

alter table public.inventory_counts
  add column if not exists count_mode text not null default 'standard',
  add column if not exists scope_type text not null default 'selected',
  add column if not exists scope_reference_id uuid,
  add column if not exists scope_selection jsonb not null default '[]'::jsonb,
  add column if not exists sort_mode text not null default 'category_name',
  add column if not exists include_zero_stock boolean not null default true;

alter table public.inventory_counts
  drop constraint if exists inventory_counts_count_mode_values,
  drop constraint if exists inventory_counts_scope_type_values,
  drop constraint if exists inventory_counts_scope_selection_array,
  drop constraint if exists inventory_counts_sort_mode_values,
  add constraint inventory_counts_count_mode_values check (count_mode in ('standard', 'blind')),
  add constraint inventory_counts_scope_type_values check (scope_type in ('full_store', 'category', 'supplier', 'selected')),
  add constraint inventory_counts_scope_selection_array check (jsonb_typeof(scope_selection) = 'array'),
  add constraint inventory_counts_sort_mode_values check (sort_mode in ('category_name', 'supplier_name', 'sku', 'barcode', 'product_name'));

alter table public.inventory_count_lines
  add column if not exists product_name_snapshot text,
  add column if not exists variant_name_snapshot text,
  add column if not exists category_name_snapshot text,
  add column if not exists sku_snapshot text,
  add column if not exists barcode_snapshot text,
  add column if not exists unit_snapshot text,
  add column if not exists line_sort_order integer not null default 0;

update public.inventory_count_lines line
set product_name_snapshot = product.name,
    variant_name_snapshot = (
      select variant.name
      from public.product_variants variant
      where variant.id = line.variant_id
        and variant.product_id = product.id
        and variant.organization_id = product.organization_id
    ),
    category_name_snapshot = coalesce((
      select category.name
      from public.categories category
      where category.id = product.category_id
        and category.organization_id = product.organization_id
    ), 'Uncategorized'),
    sku_snapshot = coalesce((
      select variant.sku
      from public.product_variants variant
      where variant.id = line.variant_id
        and variant.product_id = product.id
        and variant.organization_id = product.organization_id
    ), product.sku),
    barcode_snapshot = coalesce((
      select variant.barcode
      from public.product_variants variant
      where variant.id = line.variant_id
        and variant.product_id = product.id
        and variant.organization_id = product.organization_id
    ), product.barcode),
    unit_snapshot = product.unit
from public.products product
where product.id = line.product_id
  and product.organization_id = line.organization_id
  and line.product_name_snapshot is null;

alter table public.inventory_count_lines
  alter column product_name_snapshot set not null,
  alter column category_name_snapshot set not null,
  alter column unit_snapshot set not null,
  alter column counted_quantity drop not null,
  drop constraint if exists inventory_count_lines_quantities_nonnegative,
  add constraint inventory_count_lines_counted_quantity_nonnegative
    check (counted_quantity is null or counted_quantity >= 0);

create index if not exists inventory_count_lines_document_order_idx
  on public.inventory_count_lines (inventory_count_id, line_sort_order, id);

drop policy if exists inventory_counts_select_authorized_scope on public.inventory_counts;
create policy inventory_counts_select_authorized_scope
on public.inventory_counts for select to authenticated
using (
  (
    (select private.has_permission(organization_id, 'inventory.count'))
    or (select private.has_permission(organization_id, 'inventory.manage'))
  )
  and (select private.has_store_read_scope(organization_id, store_id))
);

drop policy if exists inventory_count_lines_select_authorized_scope on public.inventory_count_lines;
create policy inventory_count_lines_select_authorized_scope
on public.inventory_count_lines for select to authenticated
using (
  exists (
    select 1
    from public.inventory_counts inventory_count
    where inventory_count.id = inventory_count_lines.inventory_count_id
      and inventory_count.organization_id = inventory_count_lines.organization_id
      and (
        (select private.has_permission(inventory_count.organization_id, 'inventory.count'))
        or (select private.has_permission(inventory_count.organization_id, 'inventory.manage'))
      )
      and (select private.has_store_read_scope(inventory_count.organization_id, inventory_count.store_id))
  )
);

drop policy if exists inventory_levels_select_authorized_scope on public.inventory_levels;
create policy inventory_levels_select_authorized_scope on public.inventory_levels
for select to authenticated
using (
  (
    (select private.has_permission(organization_id, 'inventory.view'))
    or (select private.has_permission(organization_id, 'inventory.count'))
    or (select private.has_permission(organization_id, 'inventory.manage'))
  )
  and (select private.has_store_read_scope(organization_id, store_id))
);

create or replace function private.inventory_count_actor(
  target_organization_id uuid,
  target_store_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
begin
  if (select auth.uid()) is null or not (
    (select private.has_permission(target_organization_id, 'inventory.count'))
    or (select private.has_permission(target_organization_id, 'inventory.manage'))
  ) then
    raise exception 'Inventory count permission is required.' using errcode = '42501';
  end if;
  if not (select private.has_store_read_scope(target_organization_id, target_store_id)) then
    raise exception 'Store access is required for this inventory count.' using errcode = '42501';
  end if;
  actor_id := private.current_employee_id(target_organization_id);
  if actor_id is null or not exists (
    select 1 from public.employees employee
    where employee.id = actor_id
      and employee.organization_id = target_organization_id
      and employee.status = 'active'
  ) then
    raise exception 'An active employee record is required.' using errcode = '42501';
  end if;
  return actor_id;
end;
$$;

create or replace function private.create_inventory_count_plan(
  target_organization_id uuid,
  target_store_id uuid,
  target_note text,
  target_count_mode text,
  target_scope_type text,
  target_scope_reference_id uuid,
  target_selected_items jsonb,
  target_sort_mode text,
  target_include_zero_stock boolean
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
  prepared_line_count integer;
begin
  actor_id := private.inventory_count_actor(target_organization_id, target_store_id);

  if target_count_mode not in ('standard', 'blind')
    or target_scope_type not in ('full_store', 'category', 'supplier', 'selected')
    or target_sort_mode not in ('category_name', 'supplier_name', 'sku', 'barcode', 'product_name') then
    raise exception 'Choose valid inventory-count preparation options.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(target_selected_items, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(target_selected_items, '[]'::jsonb)) > 500 then
    raise exception 'Choose no more than 500 products for one count.' using errcode = '22023';
  end if;
  if target_scope_type in ('category', 'supplier') and target_scope_reference_id is null then
    raise exception 'Choose the category or supplier for this count.' using errcode = '22023';
  end if;
  if target_scope_type = 'selected' and jsonb_array_length(coalesce(target_selected_items, '[]'::jsonb)) = 0 then
    raise exception 'Choose at least one product for this count.' using errcode = '22023';
  end if;

  insert into public.inventory_counts (
    organization_id, store_id, status, note, started_by_employee_id,
    count_mode, scope_type, scope_reference_id, scope_selection, sort_mode, include_zero_stock
  ) values (
    target_organization_id, target_store_id, 'draft', nullif(btrim(target_note), ''), actor_id,
    target_count_mode, target_scope_type, target_scope_reference_id,
    coalesce(target_selected_items, '[]'::jsonb), target_sort_mode, target_include_zero_stock
  ) returning id, count_number into count_id, created_count_number;

  with candidates as (
    select
      product.id as product_id,
      case when product.product_type = 'variable' then variant.id else null end as variant_id,
      product.name as product_name,
      case when product.product_type = 'variable' then variant.name else null end as variant_name,
      coalesce(category.name, 'Uncategorized') as category_name,
      coalesce(case when product.product_type = 'variable' then variant.sku end, product.sku) as sku,
      coalesce(case when product.product_type = 'variable' then variant.barcode end, product.barcode) as barcode,
      product.unit,
      coalesce(level.quantity, 0)::numeric(14,3) as expected_quantity,
      coalesce((
        select min(supplier.name)
        from public.purchase_order_lines purchase_line
        join public.purchase_orders purchase_order
          on purchase_order.id = purchase_line.purchase_order_id
         and purchase_order.organization_id = purchase_line.organization_id
        join public.suppliers supplier
          on supplier.id = purchase_order.supplier_id
         and supplier.organization_id = purchase_order.organization_id
        where purchase_line.organization_id = target_organization_id
          and purchase_order.store_id = target_store_id
          and purchase_line.product_id = product.id
      ), '') as supplier_name
    from public.products product
    join public.product_store_settings setting
      on setting.product_id = product.id
     and setting.organization_id = product.organization_id
     and setting.store_id = target_store_id
    left join public.categories category
      on category.id = product.category_id
     and category.organization_id = product.organization_id
    left join public.product_variants variant
      on variant.product_id = product.id
     and variant.organization_id = product.organization_id
     and product.product_type = 'variable'
     and variant.is_active
    left join public.inventory_levels level
      on level.organization_id = product.organization_id
     and level.store_id = target_store_id
     and level.product_id = product.id
     and level.variant_id is not distinct from case when product.product_type = 'variable' then variant.id else null end
    where product.organization_id = target_organization_id
      and product.status = 'active'
      and product.track_inventory
      and (product.product_type <> 'variable' or variant.id is not null)
      and (target_include_zero_stock or coalesce(level.quantity, 0) <> 0)
      and (
        target_scope_type = 'full_store'
        or (target_scope_type = 'category' and product.category_id = target_scope_reference_id)
        or (target_scope_type = 'supplier' and exists (
          select 1
          from public.purchase_order_lines scoped_line
          join public.purchase_orders scoped_order
            on scoped_order.id = scoped_line.purchase_order_id
           and scoped_order.organization_id = scoped_line.organization_id
          where scoped_line.organization_id = target_organization_id
            and scoped_order.store_id = target_store_id
            and scoped_order.supplier_id = target_scope_reference_id
            and scoped_line.product_id = product.id
        ))
        or (target_scope_type = 'selected' and exists (
          select 1
          from jsonb_array_elements(coalesce(target_selected_items, '[]'::jsonb)) selected
          where selected ->> 'product_id' = product.id::text
            and nullif(selected ->> 'variant_id', '') is not distinct from
              (case when product.product_type = 'variable' then variant.id::text else null end)
        ))
      )
  ), ordered as (
    select candidates.*,
      row_number() over (order by
        case when target_sort_mode = 'category_name' then lower(category_name) end nulls last,
        case when target_sort_mode = 'supplier_name' then lower(supplier_name) end nulls last,
        case when target_sort_mode = 'sku' then lower(coalesce(sku, '')) end nulls last,
        case when target_sort_mode = 'barcode' then lower(coalesce(barcode, '')) end nulls last,
        lower(product_name), lower(coalesce(variant_name, '')), product_id, variant_id nulls first
      ) as sort_order
    from candidates
  )
  insert into public.inventory_count_lines (
    organization_id, inventory_count_id, product_id, variant_id,
    expected_quantity, counted_quantity, product_name_snapshot, variant_name_snapshot,
    category_name_snapshot, sku_snapshot, barcode_snapshot, unit_snapshot, line_sort_order
  )
  select
    target_organization_id, count_id, product_id, variant_id,
    expected_quantity, null, product_name, variant_name,
    category_name, sku, barcode, unit, sort_order
  from ordered
  order by sort_order;

  get diagnostics prepared_line_count = row_count;
  if prepared_line_count = 0 then
    raise exception 'No active tracked products match this count scope.' using errcode = '22023';
  end if;

  perform private.write_audit_log(
    target_organization_id, 'INVENTORY_COUNT_PREPARED', 'inventory.count', actor_id,
    null, target_store_id, null, null, null, target_note,
    jsonb_build_object(
      'inventory_count_id', count_id,
      'count_number', created_count_number,
      'count_mode', target_count_mode,
      'scope_type', target_scope_type,
      'sort_mode', target_sort_mode,
      'include_zero_stock', target_include_zero_stock,
      'line_count', prepared_line_count
    )
  );
  return count_id;
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
  actor_id := private.inventory_count_actor(target_organization_id, target_store_id);
  insert into public.inventory_counts (organization_id, store_id, status, note, started_by_employee_id)
  values (target_organization_id, target_store_id, 'draft', nullif(btrim(target_note), ''), actor_id)
  returning id, count_number into count_id, created_count_number;
  perform private.write_audit_log(
    target_organization_id, 'INVENTORY_COUNT_DRAFT_CREATED', 'inventory.count', actor_id,
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
  selected_product public.products%rowtype;
  selected_variant public.product_variants%rowtype;
  selected_category_name text;
  level_expected_quantity numeric(14,3);
  existing_line_id uuid;
  next_sort_order integer;
begin
  if target_counted_quantity < 0 then
    raise exception 'Counted quantity must be zero or greater.' using errcode = '23514';
  end if;
  select count_row.* into count_document
  from public.inventory_counts count_row
  where count_row.id = target_inventory_count_id
    and count_row.organization_id = target_organization_id
  for update;
  if count_document.id is null or count_document.status not in ('draft', 'in_progress') then
    raise exception 'Only draft or in-progress counts can be edited.' using errcode = '23514';
  end if;
  actor_id := private.inventory_count_actor(target_organization_id, count_document.store_id);

  select product.* into selected_product
  from public.products product
  where product.id = target_product_id
    and product.organization_id = target_organization_id
    and product.status = 'active'
    and product.track_inventory;
  if selected_product.id is null or not exists (
    select 1 from public.product_store_settings setting
    where setting.organization_id = target_organization_id
      and setting.store_id = count_document.store_id
      and setting.product_id = target_product_id
  ) then
    raise exception 'Choose an active tracked item assigned to this store.' using errcode = '23503';
  end if;
  if selected_product.product_type = 'variable' then
    select variant.* into selected_variant
    from public.product_variants variant
    where variant.id = target_variant_id
      and variant.product_id = target_product_id
      and variant.organization_id = target_organization_id
      and variant.is_active;
    if selected_variant.id is null then
      raise exception 'Choose an active variant for this product.' using errcode = '23503';
    end if;
  elsif target_variant_id is not null then
    raise exception 'This product does not use variants.' using errcode = '23503';
  end if;

  select line.id into existing_line_id
  from public.inventory_count_lines line
  where line.organization_id = target_organization_id
    and line.inventory_count_id = target_inventory_count_id
    and line.product_id = target_product_id
    and line.variant_id is not distinct from target_variant_id
  for update;

  if existing_line_id is null then
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
    select coalesce(category.name, 'Uncategorized') into selected_category_name
    from public.products product
    left join public.categories category
      on category.id = product.category_id
     and category.organization_id = product.organization_id
    where product.id = target_product_id
      and product.organization_id = target_organization_id;
    select coalesce(max(line.line_sort_order), 0) + 1 into next_sort_order
    from public.inventory_count_lines line
    where line.inventory_count_id = target_inventory_count_id;
    insert into public.inventory_count_lines (
      organization_id, inventory_count_id, product_id, variant_id,
      expected_quantity, counted_quantity, product_name_snapshot, variant_name_snapshot,
      category_name_snapshot, sku_snapshot, barcode_snapshot, unit_snapshot, line_sort_order
    ) values (
      target_organization_id, target_inventory_count_id, target_product_id, target_variant_id,
      level_expected_quantity, target_counted_quantity, selected_product.name, selected_variant.name,
      selected_category_name, coalesce(selected_variant.sku, selected_product.sku),
      coalesce(selected_variant.barcode, selected_product.barcode), selected_product.unit, next_sort_order
    );
  else
    update public.inventory_count_lines
    set counted_quantity = target_counted_quantity
    where id = existing_line_id;
  end if;

  update public.inventory_counts
  set status = 'in_progress', updated_at = now()
  where id = target_inventory_count_id;
end;
$$;

create or replace function private.submit_inventory_count_for_review(
  target_organization_id uuid,
  target_inventory_count_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  count_document public.inventory_counts%rowtype;
  actor_id uuid;
begin
  select count_row.* into count_document from public.inventory_counts count_row
  where count_row.id = target_inventory_count_id and count_row.organization_id = target_organization_id
  for update;
  if count_document.id is null or count_document.status not in ('draft', 'in_progress') then
    raise exception 'Only an open count with saved lines can be submitted for review.' using errcode = '23514';
  end if;
  actor_id := private.inventory_count_actor(target_organization_id, count_document.store_id);
  if not exists (
    select 1 from public.inventory_count_lines line
    where line.organization_id = target_organization_id and line.inventory_count_id = target_inventory_count_id
  ) or exists (
    select 1 from public.inventory_count_lines line
    where line.organization_id = target_organization_id
      and line.inventory_count_id = target_inventory_count_id
      and line.counted_quantity is null
  ) then
    raise exception 'Count every prepared item before submitting for review.' using errcode = '23514';
  end if;
  update public.inventory_counts set status = 'ready_for_review', updated_at = now() where id = target_inventory_count_id;
  perform private.write_audit_log(
    target_organization_id, 'INVENTORY_COUNT_READY_FOR_REVIEW', 'inventory.count', actor_id,
    null, count_document.store_id, null, null, null, count_document.note,
    jsonb_build_object('inventory_count_id', count_document.id, 'count_number', count_document.count_number)
  );
end;
$$;

create or replace function private.post_inventory_count(
  target_organization_id uuid,
  target_inventory_count_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  count_document public.inventory_counts%rowtype;
  actor_id uuid;
  line public.inventory_count_lines%rowtype;
  variance numeric(14,3);
begin
  select count_row.* into count_document from public.inventory_counts count_row
  where count_row.id = target_inventory_count_id and count_row.organization_id = target_organization_id
  for update;
  if count_document.id is null or count_document.status <> 'ready_for_review' then
    raise exception 'Only a reviewed inventory count can be posted.' using errcode = '23514';
  end if;
  actor_id := private.inventory_count_actor(target_organization_id, count_document.store_id);
  for line in
    select saved_line.* from public.inventory_count_lines saved_line
    where saved_line.organization_id = target_organization_id
      and saved_line.inventory_count_id = target_inventory_count_id
    order by saved_line.line_sort_order, saved_line.id
  loop
    if line.counted_quantity is null then
      raise exception 'Every prepared item must be counted before posting.' using errcode = '23514';
    end if;
    variance := line.counted_quantity - line.expected_quantity;
    if variance <> 0 then
      perform private.apply_inventory_change_v2(
        target_organization_id, count_document.store_id, line.product_id, line.variant_id,
        variance, 'COUNT', actor_id, 'Inventory count variance posted',
        'inventory_count', count_document.id, null, 'COUNT_VARIANCE'
      );
    end if;
  end loop;
  update public.inventory_counts
  set status = 'posted', completed_by_employee_id = actor_id, completed_at = now(), updated_at = now()
  where id = target_inventory_count_id;
  perform private.write_audit_log(
    target_organization_id, 'INVENTORY_COUNT_POSTED', 'inventory.count', actor_id,
    null, count_document.store_id, null, null, null, count_document.note,
    jsonb_build_object('inventory_count_id', count_document.id, 'count_number', count_document.count_number)
  );
end;
$$;

create or replace function private.cancel_inventory_count(
  target_organization_id uuid,
  target_inventory_count_id uuid,
  target_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  count_document public.inventory_counts%rowtype;
  actor_id uuid;
begin
  select count_row.* into count_document from public.inventory_counts count_row
  where count_row.id = target_inventory_count_id and count_row.organization_id = target_organization_id
  for update;
  if count_document.id is null or count_document.status in ('posted', 'completed', 'cancelled') then
    raise exception 'Only an open count can be cancelled.' using errcode = '23514';
  end if;
  actor_id := private.inventory_count_actor(target_organization_id, count_document.store_id);
  update public.inventory_counts
  set status = 'cancelled', note = coalesce(nullif(btrim(target_note), ''), note), updated_at = now()
  where id = target_inventory_count_id;
  perform private.write_audit_log(
    target_organization_id, 'INVENTORY_COUNT_CANCELLED', 'inventory.count', actor_id,
    null, count_document.store_id, null, null, null, target_note,
    jsonb_build_object('inventory_count_id', count_document.id, 'count_number', count_document.count_number)
  );
end;
$$;

create or replace function public.create_inventory_count_plan(
  target_organization_id uuid,
  target_store_id uuid,
  target_note text,
  target_count_mode text,
  target_scope_type text,
  target_scope_reference_id uuid,
  target_selected_items jsonb,
  target_sort_mode text,
  target_include_zero_stock boolean
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_inventory_count_plan(
    target_organization_id, target_store_id, target_note, target_count_mode,
    target_scope_type, target_scope_reference_id, target_selected_items,
    target_sort_mode, target_include_zero_stock
  );
$$;

create or replace function public.get_inventory_count_suppliers(target_organization_id uuid)
returns table (id uuid, name text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (
    (select private.has_permission(target_organization_id, 'inventory.count'))
    or (select private.has_permission(target_organization_id, 'inventory.manage'))
  ) then
    raise exception 'Inventory count permission is required.' using errcode = '42501';
  end if;

  return query
  select supplier.id, supplier.name
  from public.suppliers supplier
  where supplier.organization_id = target_organization_id
    and supplier.is_active
  order by lower(supplier.name), supplier.id;
end;
$$;

revoke execute on function private.inventory_count_actor(uuid, uuid) from public, anon, service_role;
revoke execute on function private.create_inventory_count_plan(uuid, uuid, text, text, text, uuid, jsonb, text, boolean) from public, anon, service_role;
grant execute on function private.create_inventory_count_plan(uuid, uuid, text, text, text, uuid, jsonb, text, boolean) to authenticated;
revoke execute on function public.create_inventory_count_plan(uuid, uuid, text, text, text, uuid, jsonb, text, boolean) from public, anon, service_role;
grant execute on function public.create_inventory_count_plan(uuid, uuid, text, text, text, uuid, jsonb, text, boolean) to authenticated;
revoke execute on function public.get_inventory_count_suppliers(uuid) from public, anon, service_role;
grant execute on function public.get_inventory_count_suppliers(uuid) to authenticated;

comment on function public.create_inventory_count_plan(uuid, uuid, text, text, text, uuid, jsonb, text, boolean)
is 'Creates one store-scoped inventory count and snapshots its active tracked products in a deterministic order. Blind mode is presentation-enforced from persisted metadata; posting remains variance-based.';

commit;
