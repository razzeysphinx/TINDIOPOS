-- Improvement 9: extend the existing append-only ledger with store policy,
-- cost snapshots, in-transit transfers, supplier returns, and production.
-- Historical rows remain untouched; all new stock changes use reviewed routines.
begin;

alter table public.inventory_levels
  add column average_cost_minor bigint not null default 0,
  add constraint inventory_levels_average_cost_nonnegative check (average_cost_minor >= 0);

update public.inventory_levels level
set average_cost_minor = coalesce(
  (
    select variant.cost_minor
    from public.product_variants variant
    where variant.id = level.variant_id
      and variant.product_id = level.product_id
      and variant.organization_id = level.organization_id
  ),
  product.cost_minor,
  0
)
from public.products product
where product.id = level.product_id
  and product.organization_id = level.organization_id;

alter table public.inventory_movements
  add column unit_cost_minor bigint not null default 0,
  add column value_delta_minor bigint not null default 0,
  add column reason_code text,
  add constraint inventory_movements_unit_cost_nonnegative check (unit_cost_minor >= 0);

alter table public.sale_items
  add column unit_cost_minor bigint not null default 0,
  add column cogs_minor bigint not null default 0,
  add constraint sale_items_unit_cost_nonnegative check (unit_cost_minor >= 0),
  add constraint sale_items_cogs_nonnegative check (cogs_minor >= 0);

create table public.inventory_policies (
  organization_id uuid not null references public.organizations (id) on delete restrict,
  store_id uuid not null,
  negative_stock_policy text not null default 'block',
  updated_by_employee_id uuid,
  updated_at timestamptz not null default now(),
  primary key (organization_id, store_id),
  constraint inventory_policies_store_organization_fkey foreign key (store_id, organization_id)
    references public.stores (id, organization_id) on delete restrict,
  constraint inventory_policies_employee_organization_fkey foreign key (updated_by_employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict,
  constraint inventory_policies_negative_stock_policy_values
    check (negative_stock_policy in ('allow', 'warn', 'block'))
);

create table public.inventory_adjustment_reasons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  code text not null,
  name text not null,
  movement_type text not null default 'ADJUSTMENT',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint inventory_adjustment_reasons_org_code_unique unique (organization_id, code),
  constraint inventory_adjustment_reasons_code_format check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  constraint inventory_adjustment_reasons_name_length check (char_length(btrim(name)) between 2 and 100),
  constraint inventory_adjustment_reasons_movement_type_values check (movement_type in ('ADJUSTMENT', 'DAMAGE', 'LOSS'))
);

alter table public.stock_transfers
  add column received_by_employee_id uuid,
  add column received_at timestamptz,
  drop constraint stock_transfers_status_values,
  add constraint stock_transfers_status_values check (status in ('in_transit', 'partially_received', 'completed')),
  add constraint stock_transfers_received_state check (
    (status in ('partially_received', 'completed') and received_by_employee_id is not null and received_at is not null)
    or status = 'in_transit'
    -- Transfers completed by the pre-Phase-9 one-step workflow have no separate
    -- receiving employee or receipt. Keep that historical path valid.
    or (status = 'completed' and received_by_employee_id is null and received_at is null)
  ),
  add constraint stock_transfers_receiver_organization_fkey foreign key (received_by_employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict;

alter table public.stock_transfer_lines
  add column received_quantity numeric(14,3) not null default 0,
  add column unit_cost_minor bigint not null default 0,
  add constraint stock_transfer_lines_id_organization_unique unique (id, organization_id),
  add constraint stock_transfer_lines_unit_cost_nonnegative check (unit_cost_minor >= 0),
  add constraint stock_transfer_lines_received_quantity_bounds check (received_quantity >= 0 and received_quantity <= quantity);

update public.stock_transfer_lines set received_quantity = quantity;

-- The former one-step transfer routine still writes completed transfers. Mark
-- those legacy lines as received while new in-transit transfers begin at zero.
create or replace function private.default_legacy_transfer_line_received_quantity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.received_quantity = 0 and exists (
    select 1
    from public.stock_transfers transfer
    where transfer.id = new.stock_transfer_id
      and transfer.status = 'completed'
      and transfer.received_by_employee_id is null
      and transfer.received_at is null
  ) then
    new.received_quantity := new.quantity;
  end if;
  return new;
end;
$$;

drop trigger if exists stock_transfer_lines_default_legacy_received on public.stock_transfer_lines;
create trigger stock_transfer_lines_default_legacy_received
before insert on public.stock_transfer_lines
for each row execute function private.default_legacy_transfer_line_received_quantity();

create table public.stock_transfer_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  stock_transfer_id uuid not null,
  destination_store_id uuid not null,
  received_by_employee_id uuid not null,
  note text,
  received_at timestamptz not null default now(),
  constraint stock_transfer_receipts_id_organization_unique unique (id, organization_id),
  constraint stock_transfer_receipts_transfer_organization_fkey foreign key (stock_transfer_id, organization_id)
    references public.stock_transfers (id, organization_id) on delete restrict,
  constraint stock_transfer_receipts_store_organization_fkey foreign key (destination_store_id, organization_id)
    references public.stores (id, organization_id) on delete restrict,
  constraint stock_transfer_receipts_employee_organization_fkey foreign key (received_by_employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict,
  constraint stock_transfer_receipts_note_length check (note is null or char_length(note) <= 500)
);
create index stock_transfer_receipts_transfer_received_idx
  on public.stock_transfer_receipts (stock_transfer_id, received_at desc);

create table public.stock_transfer_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  stock_transfer_receipt_id uuid not null,
  stock_transfer_line_id uuid not null,
  quantity_received numeric(14,3) not null,
  constraint stock_transfer_receipt_lines_receipt_organization_fkey foreign key (stock_transfer_receipt_id, organization_id)
    references public.stock_transfer_receipts (id, organization_id) on delete restrict,
  constraint stock_transfer_receipt_lines_line_organization_fkey foreign key (stock_transfer_line_id, organization_id)
    references public.stock_transfer_lines (id, organization_id) on delete restrict,
  constraint stock_transfer_receipt_lines_quantity_positive check (quantity_received > 0),
  constraint stock_transfer_receipt_lines_unique unique (stock_transfer_receipt_id, stock_transfer_line_id)
);
create index stock_transfer_receipt_lines_line_idx on public.stock_transfer_receipt_lines (stock_transfer_line_id);

create table public.supplier_returns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  supplier_id uuid not null,
  store_id uuid not null,
  returned_by_employee_id uuid not null,
  note text,
  returned_at timestamptz not null default now(),
  constraint supplier_returns_id_organization_unique unique (id, organization_id),
  constraint supplier_returns_supplier_organization_fkey foreign key (supplier_id, organization_id)
    references public.suppliers (id, organization_id) on delete restrict,
  constraint supplier_returns_store_organization_fkey foreign key (store_id, organization_id)
    references public.stores (id, organization_id) on delete restrict,
  constraint supplier_returns_employee_organization_fkey foreign key (returned_by_employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict,
  constraint supplier_returns_note_length check (note is null or char_length(note) <= 500)
);
create index supplier_returns_organization_store_returned_idx on public.supplier_returns (organization_id, store_id, returned_at desc);

create table public.supplier_return_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  supplier_return_id uuid not null,
  product_id uuid not null,
  variant_id uuid,
  quantity numeric(14,3) not null,
  unit_cost_minor bigint not null,
  constraint supplier_return_lines_return_organization_fkey foreign key (supplier_return_id, organization_id)
    references public.supplier_returns (id, organization_id) on delete restrict,
  constraint supplier_return_lines_product_organization_fkey foreign key (product_id, organization_id)
    references public.products (id, organization_id) on delete restrict,
  constraint supplier_return_lines_variant_product_organization_fkey foreign key (variant_id, product_id, organization_id)
    references public.product_variants (id, product_id, organization_id) on delete restrict,
  constraint supplier_return_lines_saleable_unique unique nulls not distinct (supplier_return_id, product_id, variant_id),
  constraint supplier_return_lines_quantity_positive check (quantity > 0),
  constraint supplier_return_lines_cost_nonnegative check (unit_cost_minor >= 0)
);
create index supplier_return_lines_return_idx on public.supplier_return_lines (supplier_return_id);

create table public.production_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  store_id uuid not null,
  product_id uuid not null,
  quantity_produced numeric(14,3) not null,
  produced_by_employee_id uuid not null,
  note text,
  produced_at timestamptz not null default now(),
  constraint production_runs_id_organization_unique unique (id, organization_id),
  constraint production_runs_store_organization_fkey foreign key (store_id, organization_id)
    references public.stores (id, organization_id) on delete restrict,
  constraint production_runs_product_organization_fkey foreign key (product_id, organization_id)
    references public.products (id, organization_id) on delete restrict,
  constraint production_runs_employee_organization_fkey foreign key (produced_by_employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict,
  constraint production_runs_quantity_positive check (quantity_produced > 0),
  constraint production_runs_note_length check (note is null or char_length(note) <= 500)
);
create index production_runs_organization_store_produced_idx on public.production_runs (organization_id, store_id, produced_at desc);

alter table public.inventory_movements drop constraint inventory_movements_type_values;
alter table public.inventory_movements add constraint inventory_movements_type_values check (
  movement_type in ('OPENING_STOCK', 'ADJUSTMENT', 'SALE', 'REFUND', 'RECEIPT', 'COUNT', 'TRANSFER_OUT', 'TRANSFER_IN', 'DAMAGE', 'LOSS', 'SUPPLIER_RETURN', 'PRODUCTION', 'DISASSEMBLY')
);

alter table public.inventory_policies enable row level security;
alter table public.inventory_adjustment_reasons enable row level security;
alter table public.stock_transfer_receipts enable row level security;
alter table public.stock_transfer_receipt_lines enable row level security;
alter table public.supplier_returns enable row level security;
alter table public.supplier_return_lines enable row level security;
alter table public.production_runs enable row level security;

revoke all on table public.inventory_policies, public.inventory_adjustment_reasons, public.stock_transfer_receipts, public.stock_transfer_receipt_lines, public.supplier_returns, public.supplier_return_lines, public.production_runs from public, anon, authenticated, service_role;
grant select on table public.inventory_policies, public.inventory_adjustment_reasons, public.stock_transfer_receipts, public.stock_transfer_receipt_lines, public.supplier_returns, public.supplier_return_lines, public.production_runs to authenticated;

create policy inventory_policies_select_manager on public.inventory_policies for select to authenticated using ((select private.has_permission(organization_id, 'inventory.manage')));
create policy inventory_adjustment_reasons_select_manager on public.inventory_adjustment_reasons for select to authenticated using ((select private.has_permission(organization_id, 'inventory.manage')));
create policy stock_transfer_receipts_select_manager on public.stock_transfer_receipts for select to authenticated using ((select private.has_permission(organization_id, 'inventory.manage')));
create policy stock_transfer_receipt_lines_select_manager on public.stock_transfer_receipt_lines for select to authenticated using ((select private.has_permission(organization_id, 'inventory.manage')));
create policy supplier_returns_select_manager on public.supplier_returns for select to authenticated using ((select private.has_permission(organization_id, 'inventory.manage')));
create policy supplier_return_lines_select_manager on public.supplier_return_lines for select to authenticated using ((select private.has_permission(organization_id, 'inventory.manage')));
create policy production_runs_select_manager on public.production_runs for select to authenticated using ((select private.has_permission(organization_id, 'inventory.manage')));

create or replace function private.enforce_negative_stock_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare resolved_policy text;
begin
  if new.quantity >= 0 then return new; end if;
  select policy.negative_stock_policy into resolved_policy
  from public.inventory_policies policy
  where policy.organization_id = new.organization_id and policy.store_id = new.store_id;
  if coalesce(resolved_policy, 'block') = 'block' then
    raise exception 'This store blocks negative stock. Receive or adjust stock before continuing.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_levels_enforce_negative_stock on public.inventory_levels;
create trigger inventory_levels_enforce_negative_stock
before update of quantity on public.inventory_levels
for each row execute function private.enforce_negative_stock_policy();

create or replace function private.apply_inventory_change_v2(
  target_organization_id uuid,
  target_store_id uuid,
  target_product_id uuid,
  target_variant_id uuid,
  target_quantity_delta numeric,
  target_movement_type text,
  target_actor_employee_id uuid,
  target_reason text,
  target_source_type text,
  target_source_id uuid,
  target_unit_cost_minor bigint default null,
  target_reason_code text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_quantity numeric(14,3);
  next_quantity numeric(14,3);
  current_average_cost bigint;
  resolved_unit_cost bigint;
  next_average_cost bigint;
begin
  if target_quantity_delta = 0
    or target_reason is null
    or char_length(btrim(target_reason)) not between 2 and 500 then
    raise exception 'Inventory quantity and reason are required.' using errcode = '23514';
  end if;
  select level.quantity, level.average_cost_minor
  into current_quantity, current_average_cost
  from public.inventory_levels level
  where level.organization_id = target_organization_id
    and level.store_id = target_store_id
    and level.product_id = target_product_id
    and level.variant_id is not distinct from target_variant_id
  for update;
  if not found then raise exception 'The stock projection is not initialized for this item and store.' using errcode = '23514'; end if;

  next_quantity := current_quantity + target_quantity_delta;
  resolved_unit_cost := greatest(coalesce(target_unit_cost_minor, current_average_cost, 0), 0);
  next_average_cost := current_average_cost;
  if target_quantity_delta > 0 and target_movement_type in ('RECEIPT', 'TRANSFER_IN', 'PRODUCTION') and next_quantity > 0 then
    next_average_cost := round(((current_quantity * current_average_cost) + (target_quantity_delta * resolved_unit_cost)) / next_quantity)::bigint;
  end if;

  update public.inventory_levels
  set quantity = next_quantity, average_cost_minor = next_average_cost, updated_at = now()
  where organization_id = target_organization_id and store_id = target_store_id
    and product_id = target_product_id and variant_id is not distinct from target_variant_id;

  insert into public.inventory_movements (
    organization_id, store_id, product_id, variant_id, quantity_delta, quantity_before, quantity_after,
    movement_type, actor_employee_id, reason, source_type, source_id, unit_cost_minor, value_delta_minor, reason_code
  ) values (
    target_organization_id, target_store_id, target_product_id, target_variant_id, target_quantity_delta,
    current_quantity, next_quantity, target_movement_type, target_actor_employee_id, btrim(target_reason),
    target_source_type, target_source_id, resolved_unit_cost, round(target_quantity_delta * resolved_unit_cost)::bigint, target_reason_code
  );
end;
$$;

create or replace function private.update_inventory_policy(
  target_organization_id uuid,
  target_store_id uuid,
  target_negative_stock_policy text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid;
begin
  if (select auth.uid()) is null or not (select private.has_permission(target_organization_id, 'inventory.manage')) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;
  if target_negative_stock_policy not in ('allow', 'warn', 'block')
    or not exists (select 1 from public.stores store where store.id = target_store_id and store.organization_id = target_organization_id and store.is_active) then
    raise exception 'Choose an active store and a valid negative-stock policy.' using errcode = '23514';
  end if;
  actor_id := private.inventory_actor(target_organization_id, target_store_id);
  if actor_id is null then raise exception 'An assigned employee is required for this store.' using errcode = '42501'; end if;
  insert into public.inventory_policies (organization_id, store_id, negative_stock_policy, updated_by_employee_id)
  values (target_organization_id, target_store_id, target_negative_stock_policy, actor_id)
  on conflict (organization_id, store_id) do update
    set negative_stock_policy = excluded.negative_stock_policy, updated_by_employee_id = excluded.updated_by_employee_id, updated_at = now();
  perform private.write_audit_log(target_organization_id, 'INVENTORY_POLICY_UPDATED', 'inventory.manage', actor_id, null, target_store_id, null, null, null, null, jsonb_build_object('negative_stock_policy', target_negative_stock_policy));
end;
$$;

create or replace function public.update_inventory_policy(target_organization_id uuid, target_store_id uuid, target_negative_stock_policy text)
returns void language sql security invoker set search_path = '' as $$
  select private.update_inventory_policy(target_organization_id, target_store_id, target_negative_stock_policy);
$$;

create or replace function private.create_inventory_adjustment_reason(
  target_organization_id uuid, target_code text, target_name text, target_movement_type text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare reason_id uuid;
begin
  if (select auth.uid()) is null or not (select private.has_permission(target_organization_id, 'inventory.manage')) then raise exception 'Inventory permission is required.' using errcode = '42501'; end if;
  insert into public.inventory_adjustment_reasons (organization_id, code, name, movement_type)
  values (target_organization_id, upper(btrim(target_code)), btrim(target_name), target_movement_type)
  returning id into reason_id;
  return reason_id;
end;
$$;
create or replace function public.create_inventory_adjustment_reason(target_organization_id uuid, target_code text, target_name text, target_movement_type text)
returns uuid language sql security invoker set search_path = '' as $$
  select private.create_inventory_adjustment_reason(target_organization_id, target_code, target_name, target_movement_type);
$$;

create or replace function private.record_inventory_adjustment_v2(
  target_organization_id uuid, target_store_id uuid, target_product_id uuid, target_variant_id uuid,
  target_quantity_delta numeric, target_reason_code text, target_note text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid; selected_reason public.inventory_adjustment_reasons%rowtype; movement_id uuid;
begin
  if (select auth.uid()) is null or not (select private.has_permission(target_organization_id, 'inventory.manage')) then raise exception 'Inventory permission is required.' using errcode = '42501'; end if;
  actor_id := private.inventory_actor(target_organization_id, target_store_id);
  if actor_id is null then raise exception 'An assigned employee is required for this store.' using errcode = '42501'; end if;
  select * into selected_reason from public.inventory_adjustment_reasons reason where reason.organization_id = target_organization_id and reason.code = upper(btrim(target_reason_code)) and reason.is_active;
  if selected_reason.id is null then raise exception 'Choose an active adjustment reason.' using errcode = '23514'; end if;
  perform private.apply_inventory_change_v2(target_organization_id, target_store_id, target_product_id, target_variant_id, target_quantity_delta, selected_reason.movement_type, actor_id, coalesce(nullif(btrim(target_note), ''), selected_reason.name), 'inventory_adjustment', null, null, selected_reason.code);
  select movement.id into movement_id from public.inventory_movements movement where movement.organization_id = target_organization_id and movement.store_id = target_store_id and movement.product_id = target_product_id and movement.variant_id is not distinct from target_variant_id and movement.actor_employee_id = actor_id order by movement.created_at desc, movement.id desc limit 1;
  perform private.write_audit_log(target_organization_id, 'INVENTORY_ADJUSTED', 'inventory.adjust', actor_id, null, target_store_id, null, null, null, coalesce(nullif(btrim(target_note), ''), selected_reason.name), jsonb_build_object('reason_code', selected_reason.code, 'quantity_delta', target_quantity_delta));
  return movement_id;
end;
$$;
create or replace function public.record_inventory_adjustment_v2(target_organization_id uuid, target_store_id uuid, target_product_id uuid, target_variant_id uuid, target_quantity_delta numeric, target_reason_code text, target_note text)
returns uuid language sql security invoker set search_path = '' as $$
  select private.record_inventory_adjustment_v2(target_organization_id, target_store_id, target_product_id, target_variant_id, target_quantity_delta, target_reason_code, target_note);
$$;

create or replace function private.ship_stock_transfer(
  target_organization_id uuid, target_source_store_id uuid, target_destination_store_id uuid, target_lines jsonb, target_note text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid; transfer_id uuid; line jsonb; source_level public.inventory_levels%rowtype; line_quantity numeric(14,3);
begin
  if (select auth.uid()) is null or not (select private.has_permission(target_organization_id, 'inventory.manage')) then raise exception 'Inventory permission is required.' using errcode = '42501'; end if;
  if target_source_store_id = target_destination_store_id or target_lines is null or jsonb_typeof(target_lines) <> 'array' or jsonb_array_length(target_lines) not between 1 and 100 then raise exception 'Choose two stores and one to 100 transfer items.' using errcode = '23514'; end if;
  if exists (select 1 from jsonb_array_elements(target_lines) requested(value) where jsonb_typeof(requested.value) <> 'object' or coalesce(requested.value->>'product_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or (requested.value ? 'variant_id' and requested.value->'variant_id' <> 'null'::jsonb and coalesce(requested.value->>'variant_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') or coalesce(requested.value->>'quantity','') !~ '^\d+(\.\d{1,3})?$' or (requested.value->>'quantity')::numeric <= 0) then raise exception 'Transfer lines must contain valid items and positive quantities.' using errcode = '23514'; end if;
  if (select count(*) from jsonb_array_elements(target_lines)) <> (select count(distinct (value->>'product_id') || ':' || coalesce(value->>'variant_id','')) from jsonb_array_elements(target_lines)) then raise exception 'Each transfer item can appear only once.' using errcode = '23514'; end if;
  actor_id := private.inventory_actor(target_organization_id, target_source_store_id);
  if actor_id is null then raise exception 'An assigned employee is required for the source store.' using errcode = '42501'; end if;
  if not exists (select 1 from public.stores store where store.id = target_destination_store_id and store.organization_id = target_organization_id and store.is_active) then raise exception 'Choose an active destination store.' using errcode = '23514'; end if;
  insert into public.stock_transfers (organization_id, source_store_id, destination_store_id, status, note, transferred_by_employee_id)
  values (target_organization_id, target_source_store_id, target_destination_store_id, 'in_transit', nullif(btrim(target_note), ''), actor_id)
  returning id into transfer_id;
  for line in select value from jsonb_array_elements(target_lines) order by value->>'product_id', coalesce(value->>'variant_id','') loop
    line_quantity := (line->>'quantity')::numeric(14,3);
    select * into source_level from public.inventory_levels level where level.organization_id = target_organization_id and level.store_id = target_source_store_id and level.product_id = (line->>'product_id')::uuid and level.variant_id is not distinct from nullif(line->>'variant_id','')::uuid for update;
    if source_level.id is null or source_level.quantity < line_quantity then raise exception 'Source stock is insufficient for this transfer.' using errcode = '23514'; end if;
    if not exists (select 1 from public.inventory_levels level where level.organization_id = target_organization_id and level.store_id = target_destination_store_id and level.product_id = source_level.product_id and level.variant_id is not distinct from source_level.variant_id) then raise exception 'The destination stock projection is not initialized for one transfer item.' using errcode = '23514'; end if;
    insert into public.stock_transfer_lines (organization_id, stock_transfer_id, product_id, variant_id, quantity, unit_cost_minor)
    values (target_organization_id, transfer_id, source_level.product_id, source_level.variant_id, line_quantity, source_level.average_cost_minor);
    perform private.apply_inventory_change_v2(target_organization_id, target_source_store_id, source_level.product_id, source_level.variant_id, -line_quantity, 'TRANSFER_OUT', actor_id, 'Stock transferred out', 'stock_transfer', transfer_id, source_level.average_cost_minor);
  end loop;
  perform private.write_audit_log(target_organization_id, 'STOCK_TRANSFER_SHIPPED', 'inventory.manage', actor_id, null, target_source_store_id, null, null, null, target_note, jsonb_build_object('transfer_id', transfer_id, 'destination_store_id', target_destination_store_id));
  return transfer_id;
end;
$$;
create or replace function public.ship_stock_transfer(target_organization_id uuid, target_source_store_id uuid, target_destination_store_id uuid, target_lines jsonb, target_note text)
returns uuid language sql security invoker set search_path = '' as $$
  select private.ship_stock_transfer(target_organization_id, target_source_store_id, target_destination_store_id, target_lines, target_note);
$$;

create or replace function private.receive_stock_transfer(
  target_organization_id uuid, target_stock_transfer_id uuid, target_lines jsonb, target_note text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare transfer public.stock_transfers%rowtype; actor_id uuid; receipt_id uuid; line jsonb; transfer_line public.stock_transfer_lines%rowtype; line_quantity numeric(14,3); remaining numeric(14,3); total_remaining numeric(14,3);
begin
  if (select auth.uid()) is null or not (select private.has_permission(target_organization_id, 'inventory.manage')) then raise exception 'Inventory permission is required.' using errcode = '42501'; end if;
  if target_lines is null or jsonb_typeof(target_lines) <> 'array' or jsonb_array_length(target_lines) not between 1 and 100 then raise exception 'A transfer receipt needs one to 100 items.' using errcode = '23514'; end if;
  select * into transfer from public.stock_transfers item where item.id = target_stock_transfer_id and item.organization_id = target_organization_id and item.status in ('in_transit','partially_received') for update;
  if transfer.id is null then raise exception 'This transfer is not available for receiving.' using errcode = '23514'; end if;
  actor_id := private.inventory_actor(target_organization_id, transfer.destination_store_id);
  if actor_id is null then raise exception 'An assigned employee is required for the destination store.' using errcode = '42501'; end if;
  insert into public.stock_transfer_receipts (organization_id, stock_transfer_id, destination_store_id, received_by_employee_id, note)
  values (target_organization_id, transfer.id, transfer.destination_store_id, actor_id, nullif(btrim(target_note), '')) returning id into receipt_id;
  for line in select value from jsonb_array_elements(target_lines) loop
    if coalesce(line->>'stock_transfer_line_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or coalesce(line->>'quantity','') !~ '^\d+(\.\d{1,3})?$' or (line->>'quantity')::numeric <= 0 then raise exception 'Receipt lines must include a valid transfer line and positive quantity.' using errcode = '23514'; end if;
    select * into transfer_line from public.stock_transfer_lines item where item.id = (line->>'stock_transfer_line_id')::uuid and item.stock_transfer_id = transfer.id and item.organization_id = target_organization_id for update;
    if transfer_line.id is null then raise exception 'A receipt line does not belong to this transfer.' using errcode = '23514'; end if;
    line_quantity := (line->>'quantity')::numeric(14,3); remaining := transfer_line.quantity - transfer_line.received_quantity;
    if line_quantity > remaining then raise exception 'Received transfer quantity cannot exceed the remaining quantity.' using errcode = '23514'; end if;
    insert into public.stock_transfer_receipt_lines (organization_id, stock_transfer_receipt_id, stock_transfer_line_id, quantity_received) values (target_organization_id, receipt_id, transfer_line.id, line_quantity);
    update public.stock_transfer_lines set received_quantity = received_quantity + line_quantity where id = transfer_line.id;
    perform private.apply_inventory_change_v2(target_organization_id, transfer.destination_store_id, transfer_line.product_id, transfer_line.variant_id, line_quantity, 'TRANSFER_IN', actor_id, 'Stock transfer received', 'stock_transfer_receipt', receipt_id, transfer_line.unit_cost_minor);
  end loop;
  select coalesce(sum(quantity - received_quantity), 0) into total_remaining from public.stock_transfer_lines where stock_transfer_id = transfer.id;
  update public.stock_transfers set status = case when total_remaining = 0 then 'completed' else 'partially_received' end, received_by_employee_id = actor_id, received_at = now(), completed_at = case when total_remaining = 0 then now() else completed_at end where id = transfer.id;
  perform private.write_audit_log(target_organization_id, 'STOCK_TRANSFER_RECEIVED', 'inventory.manage', actor_id, null, transfer.destination_store_id, null, null, null, target_note, jsonb_build_object('transfer_id', transfer.id, 'receipt_id', receipt_id, 'remaining_quantity', total_remaining));
  return receipt_id;
end;
$$;
create or replace function public.receive_stock_transfer(target_organization_id uuid, target_stock_transfer_id uuid, target_lines jsonb, target_note text)
returns uuid language sql security invoker set search_path = '' as $$
  select private.receive_stock_transfer(target_organization_id, target_stock_transfer_id, target_lines, target_note);
$$;

create or replace function private.return_to_supplier(
  target_organization_id uuid, target_store_id uuid, target_supplier_id uuid, target_lines jsonb, target_note text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid; return_id uuid; line jsonb; stock_level public.inventory_levels%rowtype; line_quantity numeric(14,3);
begin
  if (select auth.uid()) is null or not (select private.has_permission(target_organization_id, 'inventory.manage')) then raise exception 'Inventory permission is required.' using errcode = '42501'; end if;
  if target_lines is null or jsonb_typeof(target_lines) <> 'array' or jsonb_array_length(target_lines) not between 1 and 100 then raise exception 'A supplier return needs one to 100 items.' using errcode = '23514'; end if;
  actor_id := private.inventory_actor(target_organization_id, target_store_id);
  if actor_id is null then raise exception 'An assigned employee is required for this store.' using errcode = '42501'; end if;
  if not exists (select 1 from public.suppliers supplier where supplier.id = target_supplier_id and supplier.organization_id = target_organization_id and supplier.is_active) then raise exception 'Choose an active supplier.' using errcode = '23514'; end if;
  insert into public.supplier_returns (organization_id, supplier_id, store_id, returned_by_employee_id, note) values (target_organization_id, target_supplier_id, target_store_id, actor_id, nullif(btrim(target_note), '')) returning id into return_id;
  for line in select value from jsonb_array_elements(target_lines) order by value->>'product_id', coalesce(value->>'variant_id','') loop
    if coalesce(line->>'product_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or coalesce(line->>'quantity','') !~ '^\d+(\.\d{1,3})?$' or (line->>'quantity')::numeric <= 0 then raise exception 'Supplier-return lines must include valid items and quantities.' using errcode = '23514'; end if;
    line_quantity := (line->>'quantity')::numeric(14,3);
    select * into stock_level from public.inventory_levels level where level.organization_id = target_organization_id and level.store_id = target_store_id and level.product_id = (line->>'product_id')::uuid and level.variant_id is not distinct from nullif(line->>'variant_id','')::uuid for update;
    if stock_level.id is null or stock_level.quantity < line_quantity then raise exception 'Stock is insufficient for this supplier return.' using errcode = '23514'; end if;
    insert into public.supplier_return_lines (organization_id, supplier_return_id, product_id, variant_id, quantity, unit_cost_minor) values (target_organization_id, return_id, stock_level.product_id, stock_level.variant_id, line_quantity, stock_level.average_cost_minor);
    perform private.apply_inventory_change_v2(target_organization_id, target_store_id, stock_level.product_id, stock_level.variant_id, -line_quantity, 'SUPPLIER_RETURN', actor_id, 'Returned to supplier', 'supplier_return', return_id, stock_level.average_cost_minor);
  end loop;
  perform private.write_audit_log(target_organization_id, 'SUPPLIER_RETURN_CREATED', 'inventory.manage', actor_id, null, target_store_id, null, null, null, target_note, jsonb_build_object('supplier_return_id', return_id, 'supplier_id', target_supplier_id));
  return return_id;
end;
$$;
create or replace function public.return_to_supplier(target_organization_id uuid, target_store_id uuid, target_supplier_id uuid, target_lines jsonb, target_note text)
returns uuid language sql security invoker set search_path = '' as $$
  select private.return_to_supplier(target_organization_id, target_store_id, target_supplier_id, target_lines, target_note);
$$;

create or replace function private.produce_composite(
  target_organization_id uuid, target_store_id uuid, target_product_id uuid, target_quantity numeric, target_note text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid; run_id uuid; component record; component_level public.inventory_levels%rowtype; output_level public.inventory_levels%rowtype; component_quantity numeric(14,3); total_cost numeric := 0; output_unit_cost bigint;
begin
  if (select auth.uid()) is null or not (select private.has_permission(target_organization_id, 'inventory.manage')) then raise exception 'Inventory permission is required.' using errcode = '42501'; end if;
  if target_quantity is null or target_quantity <= 0 or target_quantity <> round(target_quantity, 3) then raise exception 'Production quantity must be positive and use at most three decimals.' using errcode = '23514'; end if;
  actor_id := private.inventory_actor(target_organization_id, target_store_id);
  if actor_id is null then raise exception 'An assigned employee is required for this store.' using errcode = '42501'; end if;
  if not exists (select 1 from public.products product where product.id = target_product_id and product.organization_id = target_organization_id and product.product_type = 'composite' and product.track_inventory and product.status = 'active') then raise exception 'Choose an active composite inventory product.' using errcode = '23514'; end if;
  if not exists (select 1 from public.product_components component where component.organization_id = target_organization_id and component.product_id = target_product_id) then raise exception 'This composite product needs at least one component recipe item.' using errcode = '23514'; end if;
  -- Lock every participating projection in a deterministic order before applying changes.
  perform 1 from public.inventory_levels level where level.organization_id = target_organization_id and level.store_id = target_store_id and (level.product_id = target_product_id or exists (select 1 from public.product_components component where component.organization_id = target_organization_id and component.product_id = target_product_id and component.component_product_id = level.product_id and component.component_variant_id is not distinct from level.variant_id)) order by level.product_id, level.variant_id for update;
  select * into output_level from public.inventory_levels level where level.organization_id = target_organization_id and level.store_id = target_store_id and level.product_id = target_product_id and level.variant_id is null for update;
  if output_level.id is null then raise exception 'The composite output stock projection is not initialized.' using errcode = '23514'; end if;
  insert into public.production_runs (organization_id, store_id, product_id, quantity_produced, produced_by_employee_id, note) values (target_organization_id, target_store_id, target_product_id, target_quantity, actor_id, nullif(btrim(target_note), '')) returning id into run_id;
  for component in select * from public.product_components item where item.organization_id = target_organization_id and item.product_id = target_product_id order by item.component_product_id, item.component_variant_id loop
    component_quantity := component.quantity_per_composite * target_quantity;
    select * into component_level from public.inventory_levels level where level.organization_id = target_organization_id and level.store_id = target_store_id and level.product_id = component.component_product_id and level.variant_id is not distinct from component.component_variant_id for update;
    if component_level.id is null or component_level.quantity < component_quantity then raise exception 'One production component has insufficient stock.' using errcode = '23514'; end if;
    total_cost := total_cost + component_quantity * component_level.average_cost_minor;
    perform private.apply_inventory_change_v2(target_organization_id, target_store_id, component_level.product_id, component_level.variant_id, -component_quantity, 'PRODUCTION', actor_id, 'Consumed by production', 'production_run', run_id, component_level.average_cost_minor);
  end loop;
  output_unit_cost := round(total_cost / target_quantity)::bigint;
  perform private.apply_inventory_change_v2(target_organization_id, target_store_id, target_product_id, null, target_quantity, 'PRODUCTION', actor_id, 'Produced composite stock', 'production_run', run_id, output_unit_cost);
  perform private.write_audit_log(target_organization_id, 'PRODUCTION_COMPLETED', 'inventory.manage', actor_id, null, target_store_id, null, null, null, target_note, jsonb_build_object('production_run_id', run_id, 'product_id', target_product_id, 'quantity', target_quantity, 'unit_cost_minor', output_unit_cost));
  return run_id;
end;
$$;
create or replace function public.produce_composite(target_organization_id uuid, target_store_id uuid, target_product_id uuid, target_quantity numeric, target_note text)
returns uuid language sql security invoker set search_path = '' as $$
  select private.produce_composite(target_organization_id, target_store_id, target_product_id, target_quantity, target_note);
$$;

create or replace function public.get_inventory_valuation(target_organization_id uuid)
returns table (store_id uuid, product_id uuid, variant_id uuid, quantity numeric, average_cost_minor bigint, value_minor bigint)
language sql security invoker set search_path = '' as $$
  select level.store_id, level.product_id, level.variant_id, level.quantity, level.average_cost_minor, round(level.quantity * level.average_cost_minor)::bigint
  from public.inventory_levels level
  where level.organization_id = target_organization_id
    and (select private.has_permission(target_organization_id, 'inventory.manage'));
$$;

-- Keep the existing receipt RPC and UI, but route future receipts through the
-- valuation-aware ledger helper so weighted average cost is preserved.
create or replace function private.receive_purchase_order(
  target_organization_id uuid, target_purchase_order_id uuid, target_lines jsonb, target_note text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare purchase public.purchase_orders%rowtype; actor_id uuid; receipt_id uuid; line jsonb; po_line public.purchase_order_lines%rowtype; quantity_received numeric(14,3); total_remaining numeric(14,3);
begin
  if (select auth.uid()) is null or not (select private.has_permission(target_organization_id, 'inventory.manage')) then raise exception 'Inventory permission is required.' using errcode = '42501'; end if;
  if target_lines is null or jsonb_typeof(target_lines) <> 'array' or jsonb_array_length(target_lines) not between 1 and 100 then raise exception 'A receipt needs one to 100 items.' using errcode = '23514'; end if;
  select * into purchase from public.purchase_orders item where item.id = target_purchase_order_id and item.organization_id = target_organization_id and item.status in ('ordered','partially_received') for update;
  if purchase.id is null then raise exception 'This purchase order cannot be received.' using errcode = '23514'; end if;
  actor_id := private.inventory_actor(target_organization_id, purchase.store_id); if actor_id is null then raise exception 'An assigned employee is required for this store.' using errcode = '42501'; end if;
  insert into public.goods_receipts (organization_id, purchase_order_id, store_id, received_by_employee_id, note) values (target_organization_id, purchase.id, purchase.store_id, actor_id, nullif(btrim(target_note), '')) returning id into receipt_id;
  for line in select value from jsonb_array_elements(target_lines) loop
    if coalesce(line->>'purchase_order_line_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or coalesce(line->>'quantity','') !~ '^\d+(\.\d{1,3})?$' or (line->>'quantity')::numeric <= 0 then raise exception 'Receipt quantities must be positive.' using errcode = '23514'; end if;
    select * into po_line from public.purchase_order_lines item where item.id = (line->>'purchase_order_line_id')::uuid and item.purchase_order_id = purchase.id and item.organization_id = target_organization_id for update;
    if po_line.id is null then raise exception 'A receipt line does not belong to this purchase order.' using errcode = '23514'; end if;
    quantity_received := (line->>'quantity')::numeric(14,3); if po_line.received_quantity + quantity_received > po_line.ordered_quantity then raise exception 'Received quantity cannot exceed the ordered quantity.' using errcode = '23514'; end if;
    insert into public.goods_receipt_lines (organization_id, goods_receipt_id, purchase_order_line_id, quantity_received) values (target_organization_id, receipt_id, po_line.id, quantity_received);
    update public.purchase_order_lines set received_quantity = received_quantity + quantity_received where id = po_line.id;
    perform private.apply_inventory_change_v2(target_organization_id, purchase.store_id, po_line.product_id, po_line.variant_id, quantity_received, 'RECEIPT', actor_id, 'Purchase order receipt', 'goods_receipt', receipt_id, po_line.unit_cost_minor);
  end loop;
  select coalesce(sum(ordered_quantity - received_quantity), 0) into total_remaining from public.purchase_order_lines where purchase_order_id = purchase.id;
  update public.purchase_orders set status = case when total_remaining = 0 then 'received' else 'partially_received' end, received_at = now(), received_by_employee_id = actor_id where id = purchase.id;
  return receipt_id;
end;
$$;

create or replace function private.snapshot_sale_item_cost()
returns trigger language plpgsql security definer set search_path = '' as $$
declare cost_minor bigint;
begin
  select level.average_cost_minor into cost_minor
  from public.inventory_levels level
  join public.products product on product.id = level.product_id and product.organization_id = level.organization_id
  where level.organization_id = new.organization_id
    and level.store_id = (select sale.store_id from public.sales sale where sale.id = new.sale_id and sale.organization_id = new.organization_id)
    and level.product_id = new.product_id
    and level.variant_id is not distinct from new.variant_id;
  if cost_minor is null then
    select coalesce(variant.cost_minor, product.cost_minor, 0) into cost_minor
    from public.products product left join public.product_variants variant on variant.id = new.variant_id and variant.product_id = product.id and variant.organization_id = product.organization_id
    where product.id = new.product_id and product.organization_id = new.organization_id;
  end if;
  new.unit_cost_minor := greatest(coalesce(cost_minor, 0), 0);
  new.cogs_minor := round(new.quantity * new.unit_cost_minor)::bigint;
  return new;
end;
$$;
drop trigger if exists sale_items_snapshot_cost on public.sale_items;
create trigger sale_items_snapshot_cost before insert on public.sale_items for each row execute function private.snapshot_sale_item_cost();

revoke execute on function private.enforce_negative_stock_policy(), private.apply_inventory_change_v2(uuid,uuid,uuid,uuid,numeric,text,uuid,text,text,uuid,bigint,text), private.update_inventory_policy(uuid,uuid,text), private.create_inventory_adjustment_reason(uuid,text,text,text), private.record_inventory_adjustment_v2(uuid,uuid,uuid,uuid,numeric,text,text), private.ship_stock_transfer(uuid,uuid,uuid,jsonb,text), private.receive_stock_transfer(uuid,uuid,jsonb,text), private.return_to_supplier(uuid,uuid,uuid,jsonb,text), private.produce_composite(uuid,uuid,uuid,numeric,text), private.snapshot_sale_item_cost() from public, anon, service_role;
revoke execute on function public.update_inventory_policy(uuid,uuid,text), public.create_inventory_adjustment_reason(uuid,text,text,text), public.record_inventory_adjustment_v2(uuid,uuid,uuid,uuid,numeric,text,text), public.ship_stock_transfer(uuid,uuid,uuid,jsonb,text), public.receive_stock_transfer(uuid,uuid,jsonb,text), public.return_to_supplier(uuid,uuid,uuid,jsonb,text), public.produce_composite(uuid,uuid,uuid,numeric,text), public.get_inventory_valuation(uuid) from public, anon, service_role;
grant execute on function public.update_inventory_policy(uuid,uuid,text), public.create_inventory_adjustment_reason(uuid,text,text,text), public.record_inventory_adjustment_v2(uuid,uuid,uuid,uuid,numeric,text,text), public.ship_stock_transfer(uuid,uuid,uuid,jsonb,text), public.receive_stock_transfer(uuid,uuid,jsonb,text), public.return_to_supplier(uuid,uuid,uuid,jsonb,text), public.produce_composite(uuid,uuid,uuid,numeric,text), public.get_inventory_valuation(uuid) to authenticated;

comment on table public.inventory_policies is 'Store-level negative-stock behavior: allow, warn, or block. Missing rows safely default to block.';
comment on column public.inventory_levels.average_cost_minor is 'Current weighted-average cost per saleable item and store in minor currency units.';
comment on column public.sale_items.cogs_minor is 'Immutable COGS snapshot captured at checkout; never rewritten when catalog costs change.';
commit;
