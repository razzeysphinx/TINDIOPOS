-- Phase 5: controlled inventory adjustments.
--
-- An adjustment remains an exceptional, immutable stock document.  This
-- migration retires the executable legacy adjustment routes without deleting
-- them, and establishes one authorization-aware, idempotent command for the
-- active Inventory workspace and CSV imports.

begin;

alter table public.inventory_adjustments
  add column if not exists operation_id uuid,
  add column if not exists import_batch_id uuid;

-- Historical documents were already posted exactly once.  Their document id
-- is therefore the only safe identity to backfill as an operation id.
update public.inventory_adjustments
set operation_id = id
where operation_id is null;

alter table public.inventory_adjustments
  alter column operation_id set not null;

alter table public.inventory_adjustments
  drop constraint if exists inventory_adjustments_organization_operation_unique,
  add constraint inventory_adjustments_organization_operation_unique
    unique (organization_id, operation_id);

create table if not exists public.inventory_adjustment_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  operation_id uuid not null,
  store_id uuid not null,
  reason_code text not null,
  payload_fingerprint text not null,
  item_count integer not null,
  created_by_employee_id uuid not null,
  created_at timestamptz not null default now(),
  constraint inventory_adjustment_import_batches_organization_operation_unique
    unique (organization_id, operation_id),
  constraint inventory_adjustment_import_batches_store_organization_fkey
    foreign key (store_id, organization_id)
    references public.stores (id, organization_id) on delete restrict,
  constraint inventory_adjustment_import_batches_employee_organization_fkey
    foreign key (created_by_employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict,
  constraint inventory_adjustment_import_batches_item_count_check
    check (item_count between 1 and 500),
  constraint inventory_adjustment_import_batches_fingerprint_check
    check (char_length(payload_fingerprint) = 32)
);

alter table public.inventory_adjustments
  drop constraint if exists inventory_adjustments_import_batch_fkey,
  add constraint inventory_adjustments_import_batch_fkey
    foreign key (import_batch_id)
    references public.inventory_adjustment_import_batches (id) on delete restrict;

create index if not exists inventory_adjustments_organization_import_batch_idx
  on public.inventory_adjustments (organization_id, import_batch_id)
  where import_batch_id is not null;

alter table public.inventory_adjustment_import_batches enable row level security;
revoke all on public.inventory_adjustment_import_batches from public, anon, authenticated, service_role;
grant select on public.inventory_adjustment_import_batches to authenticated;

drop policy if exists inventory_adjustment_import_batches_select_authorized_scope
  on public.inventory_adjustment_import_batches;
create policy inventory_adjustment_import_batches_select_authorized_scope
on public.inventory_adjustment_import_batches for select to authenticated
using (
  (
    (select private.has_permission(organization_id, 'inventory.view'))
    or (select private.has_permission(organization_id, 'inventory.adjust'))
    or (select private.has_permission(organization_id, 'inventory.manage'))
  )
  and (select private.has_store_read_scope(organization_id, store_id))
);

drop policy if exists inventory_adjustments_select_authorized_scope
  on public.inventory_adjustments;
create policy inventory_adjustments_select_authorized_scope
on public.inventory_adjustments for select to authenticated
using (
  (
    (select private.has_permission(organization_id, 'inventory.view'))
    or (select private.has_permission(organization_id, 'inventory.adjust'))
    or (select private.has_permission(organization_id, 'inventory.manage'))
  )
  and (select private.has_store_read_scope(organization_id, store_id))
);

drop policy if exists inventory_adjustment_reasons_select_manager
  on public.inventory_adjustment_reasons;
create policy inventory_adjustment_reasons_select_adjuster
on public.inventory_adjustment_reasons for select to authenticated
using (
  (select private.has_permission(organization_id, 'inventory.adjust'))
  or (select private.has_permission(organization_id, 'inventory.manage'))
);

alter table public.inventory_adjustment_reasons
  drop constraint if exists inventory_adjustment_reasons_movement_type_values,
  add constraint inventory_adjustment_reasons_movement_type_values
    check (movement_type in ('ADJUSTMENT', 'DAMAGE', 'LOSS', 'OPENING_STOCK'));

-- Existing management bundles receive the narrower capability as a bundle
-- member.  This is permission-based, so custom roles can instead grant just
-- inventory.adjust without acquiring broad inventory administration.
insert into public.role_permissions (organization_id, role_id, permission_code)
select permission.organization_id, permission.role_id, 'inventory.adjust'
from public.role_permissions permission
where permission.permission_code = 'inventory.manage'
on conflict do nothing;

create or replace function private.approval_operation_permission(target_operation_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case target_operation_code
    when 'sales.refund' then 'sales.refund'
    when 'cash.pay_out' then 'cash.pay_out'
    when 'inventory.adjust' then 'inventory.adjust'
    when 'discounts.apply' then 'discounts.apply'
    when 'prices.override' then 'prices.override'
    when 'cash_drawer.open' then 'cash_drawer.open'
    when 'shifts.force_close' then 'shifts.force_close'
    when 'payments.adjust' then 'payments.accept'
    when 'sales.void' then 'sales.create'
    else null
  end;
$$;

create or replace function private.prevent_inventory_adjustment_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Inventory adjustment documents are immutable. Record a correcting adjustment instead.'
    using errcode = '55000';
end;
$$;

revoke execute on function private.prevent_inventory_adjustment_mutation() from public;

drop trigger if exists inventory_adjustments_append_only on public.inventory_adjustments;
create trigger inventory_adjustments_append_only
before update or delete on public.inventory_adjustments
for each row execute function private.prevent_inventory_adjustment_mutation();

create or replace function private.prevent_inventory_adjustment_import_batch_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Inventory adjustment import batches are immutable.' using errcode = '55000';
end;
$$;

revoke execute on function private.prevent_inventory_adjustment_import_batch_mutation() from public;

drop trigger if exists inventory_adjustment_import_batches_append_only
  on public.inventory_adjustment_import_batches;
create trigger inventory_adjustment_import_batches_append_only
before update or delete on public.inventory_adjustment_import_batches
for each row execute function private.prevent_inventory_adjustment_import_batch_mutation();

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
as $$
declare
  selected_reason public.inventory_adjustment_reasons%rowtype;
  existing_adjustment public.inventory_adjustments%rowtype;
  adjustment_id uuid;
  adjustment_number bigint;
  movement_id uuid;
  current_quantity numeric(14,3);
  quantity_before numeric(14,3);
  quantity_after numeric(14,3);
  resolved_note text;
begin
  if target_operation_id is null then
    raise exception 'An adjustment operation identity is required.' using errcode = '23514';
  end if;

  if target_quantity_delta is null
    or target_quantity_delta = 0
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
  ) then
    raise exception 'Choose an active inventory-tracked item available in this store.' using errcode = '23514';
  end if;

  select adjustment.* into existing_adjustment
  from public.inventory_adjustments adjustment
  where adjustment.organization_id = target_organization_id
    and adjustment.operation_id = target_operation_id
  for key share;

  if existing_adjustment.id is not null then
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

    if current_quantity is null
      or current_quantity <> 0
      or exists (
        select 1
        from public.inventory_movements movement
        where movement.organization_id = target_organization_id
          and movement.store_id = target_store_id
          and movement.product_id = target_product_id
          and movement.variant_id is not distinct from target_variant_id
      ) then
      raise exception 'Opening stock can only be recorded once for an item with no prior movement.' using errcode = '23514';
    end if;
  end if;

  insert into public.inventory_adjustments (
    organization_id,
    store_id,
    product_id,
    variant_id,
    quantity_delta,
    reason_code,
    note,
    operation_id,
    import_batch_id,
    created_by_employee_id
  ) values (
    target_organization_id,
    target_store_id,
    target_product_id,
    target_variant_id,
    target_quantity_delta,
    selected_reason.code,
    resolved_note,
    target_operation_id,
    target_import_batch_id,
    target_actor_employee_id
  ) returning id, adjustment_number into adjustment_id, adjustment_number;

  perform private.apply_inventory_change_v2(
    target_organization_id,
    target_store_id,
    target_product_id,
    target_variant_id,
    target_quantity_delta,
    selected_reason.movement_type,
    target_actor_employee_id,
    resolved_note,
    'inventory_adjustment',
    adjustment_id,
    null,
    selected_reason.code
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
    target_organization_id,
    'INVENTORY_ADJUSTED',
    'inventory.adjust',
    target_actor_employee_id,
    null,
    target_store_id,
    null,
    null,
    null,
    resolved_note,
    jsonb_build_object(
      'adjustment_id', adjustment_id,
      'adjustment_number', adjustment_number,
      'operation_id', target_operation_id,
      'import_batch_id', target_import_batch_id,
      'reason_code', selected_reason.code,
      'movement_type', selected_reason.movement_type,
      'quantity_before', quantity_before,
      'quantity_delta', target_quantity_delta,
      'quantity_after', quantity_after
    )
  );

  return movement_id;
end;
$$;

create or replace function private.record_inventory_adjustment(
  target_organization_id uuid,
  target_store_id uuid,
  target_product_id uuid,
  target_variant_id uuid,
  target_quantity_delta numeric,
  target_reason_code text,
  target_note text,
  target_operation_id uuid,
  target_approval_request_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  selected_reason public.inventory_adjustment_reasons%rowtype;
  resolved_note text;
  expected_payload jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Inventory adjustment permission is required.' using errcode = '42501';
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

  expected_payload := jsonb_build_object(
    'store_id', target_store_id,
    'product_id', target_product_id,
    'variant_id', target_variant_id,
    'quantity_delta', target_quantity_delta,
    'reason_code', selected_reason.code,
    'movement_type', selected_reason.movement_type,
    'note', resolved_note
  );

  perform private.authorize_sensitive_operation(
    target_organization_id,
    'inventory.adjust',
    target_approval_request_id,
    expected_payload,
    target_operation_id
  );

  actor_id := private.inventory_actor(target_organization_id, target_store_id);
  if actor_id is null then
    raise exception 'An assigned employee is required for this store.' using errcode = '42501';
  end if;

  return private.post_inventory_adjustment(
    target_organization_id,
    target_store_id,
    target_product_id,
    target_variant_id,
    target_quantity_delta,
    target_reason_code,
    resolved_note,
    target_operation_id,
    actor_id
  );
end;
$$;

create or replace function public.record_inventory_adjustment(
  target_organization_id uuid,
  target_store_id uuid,
  target_product_id uuid,
  target_variant_id uuid,
  target_quantity_delta numeric,
  target_reason_code text,
  target_note text,
  target_operation_id uuid,
  target_approval_request_id uuid default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.record_inventory_adjustment(
    target_organization_id,
    target_store_id,
    target_product_id,
    target_variant_id,
    target_quantity_delta,
    target_reason_code,
    target_note,
    target_operation_id,
    target_approval_request_id
  );
$$;

create or replace function private.import_inventory_adjustments_csv(
  target_organization_id uuid,
  target_store_id uuid,
  target_reason_code text,
  target_rows jsonb,
  target_operation_id uuid,
  target_approval_request_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  import_row record;
  row_json jsonb;
  row_number integer;
  actor_id uuid;
  batch_id uuid;
  existing_batch public.inventory_adjustment_import_batches%rowtype;
  expected_payload jsonb;
  payload_fingerprint text;
  normalized_reason_code text;
  seen_items text[] := '{}';
  row_product_id uuid;
  row_variant_id uuid;
  row_quantity numeric(14,3);
  row_note text;
begin
  if (select auth.uid()) is null or target_operation_id is null then
    raise exception 'Inventory adjustment permission and operation identity are required.' using errcode = '42501';
  end if;
  if coalesce(jsonb_typeof(target_rows), '') <> 'array'
    or coalesce(jsonb_array_length(target_rows), 0) not between 1 and 500 then
    raise exception 'Import between 1 and 500 adjustment rows at a time.' using errcode = '23514';
  end if;

  normalized_reason_code := upper(btrim(coalesce(target_reason_code, '')));
  if not exists (
    select 1 from public.inventory_adjustment_reasons reason
    where reason.organization_id = target_organization_id
      and reason.code = normalized_reason_code
      and reason.is_active
  ) then
    raise exception 'Choose an active adjustment reason.' using errcode = '23514';
  end if;

  for import_row in
    select value, ordinality from jsonb_array_elements(target_rows) with ordinality
  loop
    row_json := import_row.value;
    row_number := case
      when coalesce(row_json ->> 'row_number', '') ~ '^[1-9][0-9]*$'
        then (row_json ->> 'row_number')::integer
      else import_row.ordinality::integer
    end;
    if jsonb_typeof(row_json) <> 'object'
      or coalesce(row_json ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'CSV row % needs a valid item.', row_number using errcode = '23514';
    end if;
    if row_json ? 'variant_id'
      and row_json -> 'variant_id' <> 'null'::jsonb
      and coalesce(row_json ->> 'variant_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'CSV row % has an invalid variant.', row_number using errcode = '23514';
    end if;
    if coalesce(row_json ->> 'quantity_delta', '') !~ '^-?\d{1,8}(\.\d{1,3})?$'
      or (row_json ->> 'quantity_delta')::numeric = 0 then
      raise exception 'CSV row % needs a non-zero quantity change.', row_number using errcode = '23514';
    end if;
    if char_length(btrim(coalesce(row_json ->> 'note', ''))) not between 2 and 500 then
      raise exception 'CSV row % needs an explanation between 2 and 500 characters.', row_number using errcode = '23514';
    end if;
    row_product_id := (row_json ->> 'product_id')::uuid;
    row_variant_id := nullif(row_json ->> 'variant_id', '')::uuid;
    if concat(row_product_id::text, '|', coalesce(row_variant_id::text, '')) = any(seen_items) then
      raise exception 'CSV row % repeats an item in this file.', row_number using errcode = '23505';
    end if;
    seen_items := array_append(seen_items, concat(row_product_id::text, '|', coalesce(row_variant_id::text, '')));
  end loop;

  expected_payload := jsonb_build_object(
    'store_id', target_store_id,
    'reason_code', normalized_reason_code,
    'operation_id', target_operation_id,
    'rows', target_rows
  );
  payload_fingerprint := md5(expected_payload::text);

  perform private.authorize_sensitive_operation(
    target_organization_id,
    'inventory.adjust',
    target_approval_request_id,
    expected_payload,
    target_operation_id
  );

  actor_id := private.inventory_actor(target_organization_id, target_store_id);
  if actor_id is null then
    raise exception 'An assigned employee is required for this store.' using errcode = '42501';
  end if;

  insert into public.inventory_adjustment_import_batches (
    organization_id,
    operation_id,
    store_id,
    reason_code,
    payload_fingerprint,
    item_count,
    created_by_employee_id
  ) values (
    target_organization_id,
    target_operation_id,
    target_store_id,
    normalized_reason_code,
    payload_fingerprint,
    jsonb_array_length(target_rows),
    actor_id
  ) on conflict (organization_id, operation_id) do nothing
  returning id into batch_id;

  if batch_id is null then
    select batch.* into existing_batch
    from public.inventory_adjustment_import_batches batch
    where batch.organization_id = target_organization_id
      and batch.operation_id = target_operation_id
    for key share;

    if existing_batch.id is null then
      raise exception 'The adjustment import operation could not be recovered.' using errcode = 'P0002';
    end if;
    if existing_batch.store_id <> target_store_id
      or existing_batch.reason_code <> normalized_reason_code
      or existing_batch.item_count <> jsonb_array_length(target_rows)
      or existing_batch.payload_fingerprint <> payload_fingerprint then
      raise exception 'This adjustment import operation identity was already used for different details.' using errcode = '23505';
    end if;
    return existing_batch.item_count;
  end if;

  for import_row in
    select value from jsonb_array_elements(target_rows)
  loop
    row_quantity := (import_row.value ->> 'quantity_delta')::numeric;
    row_note := btrim(import_row.value ->> 'note');
    perform private.post_inventory_adjustment(
      target_organization_id,
      target_store_id,
      (import_row.value ->> 'product_id')::uuid,
      nullif(import_row.value ->> 'variant_id', '')::uuid,
      row_quantity,
      normalized_reason_code,
      row_note,
      gen_random_uuid(),
      actor_id,
      batch_id
    );
  end loop;

  perform private.write_audit_log(
    target_organization_id,
    'INVENTORY_ADJUSTMENTS_IMPORTED',
    'inventory.adjust',
    actor_id,
    null,
    target_store_id,
    null,
    null,
    null,
    'CSV inventory adjustment import',
    jsonb_build_object(
      'batch_id', batch_id,
      'operation_id', target_operation_id,
      'row_count', jsonb_array_length(target_rows),
      'reason_code', normalized_reason_code
    )
  );

  return jsonb_array_length(target_rows);
end;
$$;

create or replace function public.import_inventory_adjustments_csv(
  target_organization_id uuid,
  target_store_id uuid,
  target_reason_code text,
  target_rows jsonb,
  target_operation_id uuid,
  target_approval_request_id uuid default null
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.import_inventory_adjustments_csv(
    target_organization_id,
    target_store_id,
    target_reason_code,
    target_rows,
    target_operation_id,
    target_approval_request_id
  );
$$;

-- The formerly mounted catalog adjustment route has no in-app caller now.
-- Keep its implementation for forensic compatibility, but prevent it from
-- becoming a second executable adjustment command.
revoke execute on function
  private.adjust_inventory(uuid,uuid,uuid,uuid,numeric,text,text),
  public.adjust_inventory(uuid,uuid,uuid,uuid,numeric,text,text,uuid),
  private.record_inventory_adjustment_v2(uuid,uuid,uuid,uuid,numeric,text,text),
  public.record_inventory_adjustment_v2(uuid,uuid,uuid,uuid,numeric,text,text),
  private.import_inventory_adjustments_csv(uuid,uuid,text,jsonb),
  public.import_inventory_adjustments_csv(uuid,uuid,text,jsonb)
from public, anon, authenticated, service_role;

revoke execute on function
  private.post_inventory_adjustment(uuid,uuid,uuid,uuid,numeric,text,text,uuid,uuid,uuid),
  private.prevent_inventory_adjustment_mutation(),
  private.prevent_inventory_adjustment_import_batch_mutation()
from public, anon, authenticated, service_role;

revoke execute on function
  private.record_inventory_adjustment(uuid,uuid,uuid,uuid,numeric,text,text,uuid,uuid),
  private.import_inventory_adjustments_csv(uuid,uuid,text,jsonb,uuid,uuid),
  public.record_inventory_adjustment(uuid,uuid,uuid,uuid,numeric,text,text,uuid,uuid),
  public.import_inventory_adjustments_csv(uuid,uuid,text,jsonb,uuid,uuid)
from public, anon, service_role;

grant execute on function
  private.record_inventory_adjustment(uuid,uuid,uuid,uuid,numeric,text,text,uuid,uuid),
  private.import_inventory_adjustments_csv(uuid,uuid,text,jsonb,uuid,uuid),
  public.record_inventory_adjustment(uuid,uuid,uuid,uuid,numeric,text,text,uuid,uuid),
  public.import_inventory_adjustments_csv(uuid,uuid,text,jsonb,uuid,uuid)
to authenticated;

comment on function public.adjust_inventory(uuid,uuid,uuid,uuid,numeric,text,text,uuid) is
  'CANDIDATE_FOR_REMOVAL: superseded by public.record_inventory_adjustment; execute is revoked from normal application roles.';
comment on function public.record_inventory_adjustment_v2(uuid,uuid,uuid,uuid,numeric,text,text) is
  'CANDIDATE_FOR_REMOVAL: superseded by public.record_inventory_adjustment; execute is revoked from normal application roles.';
comment on function public.import_inventory_adjustments_csv(uuid,uuid,text,jsonb) is
  'CANDIDATE_FOR_REMOVAL: superseded by the operation-id version; execute is revoked from normal application roles.';
comment on table public.inventory_adjustment_import_batches is
  'Immutable CSV adjustment batch identities. Retries return the original batch result without double-posting stock.';

commit;
