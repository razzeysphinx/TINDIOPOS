-- Master inventory control: durable adjustment documents and a reviewed count
-- lifecycle. This extends the existing immutable inventory ledger; it never
-- rewrites historical movements or permits direct inventory-level updates.
begin;

create sequence if not exists private.inventory_adjustment_number_sequence;
create sequence if not exists private.inventory_count_number_sequence;

create table if not exists public.inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  adjustment_number bigint not null default nextval('private.inventory_adjustment_number_sequence'),
  store_id uuid not null,
  product_id uuid not null,
  variant_id uuid,
  quantity_delta numeric(14,3) not null,
  reason_code text not null,
  note text,
  created_by_employee_id uuid not null,
  created_at timestamptz not null default now(),
  constraint inventory_adjustments_organization_number_unique unique (organization_id, adjustment_number),
  constraint inventory_adjustments_store_organization_fkey foreign key (store_id, organization_id)
    references public.stores (id, organization_id) on delete restrict,
  constraint inventory_adjustments_product_organization_fkey foreign key (product_id, organization_id)
    references public.products (id, organization_id) on delete restrict,
  constraint inventory_adjustments_variant_product_organization_fkey foreign key (variant_id, product_id, organization_id)
    references public.product_variants (id, product_id, organization_id) on delete restrict,
  constraint inventory_adjustments_employee_organization_fkey foreign key (created_by_employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict,
  constraint inventory_adjustments_quantity_nonzero check (quantity_delta <> 0),
  constraint inventory_adjustments_note_length check (note is null or char_length(note) <= 500)
);

create index if not exists inventory_adjustments_organization_store_created_idx
  on public.inventory_adjustments (organization_id, store_id, created_at desc);

alter table public.inventory_adjustments enable row level security;
revoke all on public.inventory_adjustments from public, anon, authenticated, service_role;
grant select on public.inventory_adjustments to authenticated;
create policy inventory_adjustments_select_authorized_scope
on public.inventory_adjustments for select to authenticated
using (
  (select private.has_permission(organization_id, 'inventory.manage'))
  and (select private.has_store_read_scope(organization_id, store_id))
);

alter table public.inventory_counts
  add column if not exists count_number bigint,
  add column if not exists updated_at timestamptz not null default now();

update public.inventory_counts
set count_number = nextval('private.inventory_count_number_sequence')
where count_number is null;

alter table public.inventory_counts
  alter column count_number set not null,
  alter column count_number set default nextval('private.inventory_count_number_sequence');

alter table public.inventory_counts
  drop constraint if exists inventory_counts_status_values,
  drop constraint if exists inventory_counts_completion_state,
  add constraint inventory_counts_organization_number_unique unique (organization_id, count_number),
  add constraint inventory_counts_status_values check (status in ('draft', 'in_progress', 'ready_for_review', 'posted', 'cancelled', 'open', 'completed')),
  add constraint inventory_counts_completion_state check (
    (status in ('posted', 'completed') and completed_by_employee_id is not null and completed_at is not null)
    or status not in ('posted', 'completed')
  );

create index if not exists inventory_counts_organization_store_status_updated_idx
  on public.inventory_counts (organization_id, store_id, status, updated_at desc);

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
  adjustment_number bigint;
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
  ) returning id, adjustment_number into adjustment_id, adjustment_number;

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
      'adjustment_number', adjustment_number,
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
  count_number bigint;
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
  returning id, count_number into count_id, count_number;

  perform private.write_audit_log(
    target_organization_id, 'INVENTORY_COUNT_DRAFT_CREATED', 'inventory.manage', actor_id,
    null, target_store_id, null, null, null, target_note,
    jsonb_build_object('inventory_count_id', count_id, 'count_number', count_number)
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
  expected_quantity numeric(14,3);
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

  select level.quantity into expected_quantity
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
      expected_quantity, target_counted_quantity
    );
  else
    update public.inventory_count_lines
    set expected_quantity = expected_quantity,
        counted_quantity = target_counted_quantity
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
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'inventory.manage')) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;
  select count_row.* into count_document
  from public.inventory_counts count_row
  where count_row.id = target_inventory_count_id
    and count_row.organization_id = target_organization_id
  for update;
  if count_document.id is null or count_document.status not in ('draft', 'in_progress') then
    raise exception 'Only an open count with saved lines can be submitted for review.' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.inventory_count_lines line
    where line.organization_id = target_organization_id
      and line.inventory_count_id = target_inventory_count_id
  ) then
    raise exception 'Add at least one counted item before review.' using errcode = '23514';
  end if;
  actor_id := private.inventory_actor(target_organization_id, count_document.store_id);
  if actor_id is null then
    raise exception 'An assigned employee is required for this store.' using errcode = '42501';
  end if;
  update public.inventory_counts
  set status = 'ready_for_review', updated_at = now()
  where id = target_inventory_count_id;
  perform private.write_audit_log(
    target_organization_id, 'INVENTORY_COUNT_READY_FOR_REVIEW', 'inventory.manage', actor_id,
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
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'inventory.manage')) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;
  select count_row.* into count_document
  from public.inventory_counts count_row
  where count_row.id = target_inventory_count_id
    and count_row.organization_id = target_organization_id
  for update;
  if count_document.id is null or count_document.status <> 'ready_for_review' then
    raise exception 'Only a reviewed inventory count can be posted.' using errcode = '23514';
  end if;
  actor_id := private.inventory_actor(target_organization_id, count_document.store_id);
  if actor_id is null then
    raise exception 'An assigned employee is required for this store.' using errcode = '42501';
  end if;

  -- Variances compare the count-time snapshot to the physical count. Applying
  -- that variance to the current locked projection preserves sales, receipts,
  -- and transfers that occurred after counting began instead of double-reducing.
  for line in
    select saved_line.*
    from public.inventory_count_lines saved_line
    where saved_line.organization_id = target_organization_id
      and saved_line.inventory_count_id = target_inventory_count_id
    order by saved_line.product_id, saved_line.variant_id nulls first
  loop
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
    target_organization_id, 'INVENTORY_COUNT_POSTED', 'inventory.manage', actor_id,
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
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'inventory.manage')) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;
  select count_row.* into count_document
  from public.inventory_counts count_row
  where count_row.id = target_inventory_count_id
    and count_row.organization_id = target_organization_id
  for update;
  if count_document.id is null or count_document.status in ('posted', 'completed', 'cancelled') then
    raise exception 'Only an open count can be cancelled.' using errcode = '23514';
  end if;
  actor_id := private.inventory_actor(target_organization_id, count_document.store_id);
  if actor_id is null then
    raise exception 'An assigned employee is required for this store.' using errcode = '42501';
  end if;
  update public.inventory_counts
  set status = 'cancelled', note = coalesce(nullif(btrim(target_note), ''), note), updated_at = now()
  where id = target_inventory_count_id;
  perform private.write_audit_log(
    target_organization_id, 'INVENTORY_COUNT_CANCELLED', 'inventory.manage', actor_id,
    null, count_document.store_id, null, null, null, target_note,
    jsonb_build_object('inventory_count_id', count_document.id, 'count_number', count_document.count_number)
  );
end;
$$;

create or replace function public.create_inventory_count_draft(
  target_organization_id uuid,
  target_store_id uuid,
  target_note text default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.create_inventory_count_draft(target_organization_id, target_store_id, target_note); $$;

create or replace function public.save_inventory_count_line(
  target_organization_id uuid,
  target_inventory_count_id uuid,
  target_product_id uuid,
  target_variant_id uuid,
  target_counted_quantity numeric
)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.save_inventory_count_line(target_organization_id, target_inventory_count_id, target_product_id, target_variant_id, target_counted_quantity); $$;

create or replace function public.submit_inventory_count_for_review(
  target_organization_id uuid,
  target_inventory_count_id uuid
)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.submit_inventory_count_for_review(target_organization_id, target_inventory_count_id); $$;

create or replace function public.post_inventory_count(
  target_organization_id uuid,
  target_inventory_count_id uuid
)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.post_inventory_count(target_organization_id, target_inventory_count_id); $$;

create or replace function public.cancel_inventory_count(
  target_organization_id uuid,
  target_inventory_count_id uuid,
  target_note text default null
)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.cancel_inventory_count(target_organization_id, target_inventory_count_id, target_note); $$;

revoke execute on function
  private.record_inventory_adjustment_v2(uuid,uuid,uuid,uuid,numeric,text,text),
  private.create_inventory_count_draft(uuid,uuid,text),
  private.save_inventory_count_line(uuid,uuid,uuid,uuid,numeric),
  private.submit_inventory_count_for_review(uuid,uuid),
  private.post_inventory_count(uuid,uuid),
  private.cancel_inventory_count(uuid,uuid,text)
from public, anon, service_role;
grant execute on function
  private.record_inventory_adjustment_v2(uuid,uuid,uuid,uuid,numeric,text,text),
  private.create_inventory_count_draft(uuid,uuid,text),
  private.save_inventory_count_line(uuid,uuid,uuid,uuid,numeric),
  private.submit_inventory_count_for_review(uuid,uuid),
  private.post_inventory_count(uuid,uuid),
  private.cancel_inventory_count(uuid,uuid,text)
to authenticated;

revoke execute on function
  public.create_inventory_count_draft(uuid,uuid,text),
  public.save_inventory_count_line(uuid,uuid,uuid,uuid,numeric),
  public.submit_inventory_count_for_review(uuid,uuid),
  public.post_inventory_count(uuid,uuid),
  public.cancel_inventory_count(uuid,uuid,text)
from public, anon, service_role;
grant execute on function
  public.create_inventory_count_draft(uuid,uuid,text),
  public.save_inventory_count_line(uuid,uuid,uuid,uuid,numeric),
  public.submit_inventory_count_for_review(uuid,uuid),
  public.post_inventory_count(uuid,uuid),
  public.cancel_inventory_count(uuid,uuid,text)
to authenticated;

comment on table public.inventory_adjustments is 'Immutable adjustment document headers. Inventory movement source_id links every adjustment to this document.';
comment on column public.inventory_counts.count_number is 'Human-readable inventory-count document number. Historical open/completed counts remain unchanged.';

commit;
