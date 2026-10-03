-- Improvement 14: multi-store replenishment. A request does not move stock;
-- dispatch creates the in-transit transfer and receiving posts the destination
-- ledger movement. Short quantities remain documented discrepancies.
begin;

create sequence private.tindio_stock_request_number_sequence as bigint start with 1;

alter table public.suppliers
  add column lead_time_days integer not null default 0,
  add constraint suppliers_lead_time_days_range check (lead_time_days between 0 and 365);

-- A manual expected date always wins. Otherwise a purchase order uses the
-- supplier's configured lead time so it appears in the inbound-stock view.
create or replace function private.default_purchase_order_expected_at_from_supplier()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.expected_at is null then
    select current_date + supplier.lead_time_days into new.expected_at
    from public.suppliers supplier
    where supplier.id = new.supplier_id and supplier.organization_id = new.organization_id;
  end if;
  return new;
end;
$$;
drop trigger if exists purchase_orders_default_expected_at_from_supplier on public.purchase_orders;
create trigger purchase_orders_default_expected_at_from_supplier
before insert on public.purchase_orders
for each row execute function private.default_purchase_order_expected_at_from_supplier();

create table public.supply_chain_warehouses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  store_id uuid not null,
  code text not null,
  name text not null,
  notes text,
  is_active boolean not null default true,
  created_by_employee_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supply_chain_warehouses_id_organization_unique unique (id, organization_id),
  constraint supply_chain_warehouses_store_organization_fkey foreign key (store_id, organization_id)
    references public.stores (id, organization_id) on delete restrict,
  constraint supply_chain_warehouses_creator_organization_fkey foreign key (created_by_employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict,
  constraint supply_chain_warehouses_org_store_unique unique (organization_id, store_id),
  constraint supply_chain_warehouses_org_code_unique unique (organization_id, code),
  constraint supply_chain_warehouses_code_format check (code ~ '^[A-Z][A-Z0-9_-]{1,39}$'),
  constraint supply_chain_warehouses_name_length check (char_length(btrim(name)) between 2 and 120),
  constraint supply_chain_warehouses_notes_length check (notes is null or char_length(notes) <= 500)
);
create index supply_chain_warehouses_organization_active_idx
  on public.supply_chain_warehouses (organization_id, is_active, name);
create trigger supply_chain_warehouses_set_updated_at
before update on public.supply_chain_warehouses
for each row execute function private.set_updated_at();

create table public.inventory_replenishment_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  store_id uuid not null,
  product_id uuid not null,
  variant_id uuid,
  preferred_warehouse_id uuid,
  reorder_point numeric(14,3) not null,
  target_stock numeric(14,3) not null,
  updated_by_employee_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_replenishment_rules_id_organization_unique unique (id, organization_id),
  constraint inventory_replenishment_rules_store_organization_fkey foreign key (store_id, organization_id)
    references public.stores (id, organization_id) on delete restrict,
  constraint inventory_replenishment_rules_product_organization_fkey foreign key (product_id, organization_id)
    references public.products (id, organization_id) on delete restrict,
  constraint inventory_replenishment_rules_variant_product_organization_fkey foreign key (variant_id, product_id, organization_id)
    references public.product_variants (id, product_id, organization_id) on delete restrict,
  constraint inventory_replenishment_rules_warehouse_organization_fkey foreign key (preferred_warehouse_id, organization_id)
    references public.supply_chain_warehouses (id, organization_id) on delete restrict,
  constraint inventory_replenishment_rules_employee_organization_fkey foreign key (updated_by_employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict,
  constraint inventory_replenishment_rules_saleable_unique unique nulls not distinct (organization_id, store_id, product_id, variant_id),
  constraint inventory_replenishment_rules_quantities check (reorder_point >= 0 and target_stock > 0 and target_stock >= reorder_point)
);
create index inventory_replenishment_rules_store_reorder_idx
  on public.inventory_replenishment_rules (organization_id, store_id, reorder_point);
create trigger inventory_replenishment_rules_set_updated_at
before update on public.inventory_replenishment_rules
for each row execute function private.set_updated_at();

create table public.stock_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  request_number bigint not null,
  requesting_store_id uuid not null,
  source_warehouse_id uuid not null,
  status text not null default 'requested',
  note text,
  requested_by_employee_id uuid not null,
  requested_at timestamptz not null default now(),
  approved_by_employee_id uuid,
  approved_at timestamptz,
  picked_by_employee_id uuid,
  picked_at timestamptz,
  dispatched_by_employee_id uuid,
  dispatched_at timestamptz,
  received_by_employee_id uuid,
  received_at timestamptz,
  cancelled_by_employee_id uuid,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stock_requests_id_organization_unique unique (id, organization_id),
  constraint stock_requests_org_number_unique unique (organization_id, request_number),
  constraint stock_requests_store_organization_fkey foreign key (requesting_store_id, organization_id)
    references public.stores (id, organization_id) on delete restrict,
  constraint stock_requests_warehouse_organization_fkey foreign key (source_warehouse_id, organization_id)
    references public.supply_chain_warehouses (id, organization_id) on delete restrict,
  constraint stock_requests_requested_by_organization_fkey foreign key (requested_by_employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict,
  constraint stock_requests_approved_by_organization_fkey foreign key (approved_by_employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict,
  constraint stock_requests_picked_by_organization_fkey foreign key (picked_by_employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict,
  constraint stock_requests_dispatched_by_organization_fkey foreign key (dispatched_by_employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict,
  constraint stock_requests_received_by_organization_fkey foreign key (received_by_employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict,
  constraint stock_requests_cancelled_by_organization_fkey foreign key (cancelled_by_employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict,
  constraint stock_requests_status_values check (status in ('requested', 'approved', 'picking', 'dispatched', 'partially_received', 'received', 'received_with_discrepancy', 'cancelled')),
  constraint stock_requests_note_length check (note is null or char_length(note) <= 500),
  constraint stock_requests_state_timestamps check (
    (status = 'requested' and approved_at is null and picked_at is null and dispatched_at is null and received_at is null and cancelled_at is null)
    or (status in ('approved', 'picking', 'dispatched', 'partially_received', 'received', 'received_with_discrepancy') and approved_at is not null and approved_by_employee_id is not null)
    or (status = 'cancelled' and cancelled_at is not null and cancelled_by_employee_id is not null)
  )
);
create index stock_requests_organization_status_requested_idx
  on public.stock_requests (organization_id, status, requested_at desc);
create index stock_requests_destination_status_idx
  on public.stock_requests (organization_id, requesting_store_id, status, requested_at desc);
create trigger stock_requests_set_updated_at before update on public.stock_requests
for each row execute function private.set_updated_at();

create table public.stock_request_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  stock_request_id uuid not null,
  product_id uuid not null,
  variant_id uuid,
  product_name_snapshot text not null,
  variant_name_snapshot text,
  unit_snapshot text not null,
  requested_quantity numeric(14,3) not null,
  approved_quantity numeric(14,3) not null default 0,
  picked_quantity numeric(14,3) not null default 0,
  dispatched_quantity numeric(14,3) not null default 0,
  received_quantity numeric(14,3) not null default 0,
  short_quantity numeric(14,3) not null default 0,
  constraint stock_request_lines_id_organization_unique unique (id, organization_id),
  constraint stock_request_lines_request_organization_fkey foreign key (stock_request_id, organization_id)
    references public.stock_requests (id, organization_id) on delete restrict,
  constraint stock_request_lines_product_organization_fkey foreign key (product_id, organization_id)
    references public.products (id, organization_id) on delete restrict,
  constraint stock_request_lines_variant_product_organization_fkey foreign key (variant_id, product_id, organization_id)
    references public.product_variants (id, product_id, organization_id) on delete restrict,
  constraint stock_request_lines_saleable_unique unique nulls not distinct (stock_request_id, product_id, variant_id),
  constraint stock_request_lines_snapshots check (char_length(btrim(product_name_snapshot)) between 1 and 200 and char_length(btrim(unit_snapshot)) between 1 and 40),
  constraint stock_request_lines_quantities check (
    requested_quantity > 0 and approved_quantity >= 0 and picked_quantity >= 0 and dispatched_quantity >= 0 and received_quantity >= 0 and short_quantity >= 0
    and approved_quantity <= requested_quantity and picked_quantity <= approved_quantity and dispatched_quantity <= picked_quantity and received_quantity + short_quantity <= dispatched_quantity
  )
);
create index stock_request_lines_request_idx on public.stock_request_lines (stock_request_id);

alter table public.stock_transfers
  add column stock_request_id uuid,
  add constraint stock_transfers_request_organization_fkey foreign key (stock_request_id, organization_id)
    references public.stock_requests (id, organization_id) on delete restrict,
  add constraint stock_transfers_request_unique unique (stock_request_id);

alter table public.stock_transfer_lines
  add column stock_request_line_id uuid,
  add column short_quantity numeric(14,3) not null default 0,
  add constraint stock_transfer_lines_request_line_organization_fkey foreign key (stock_request_line_id, organization_id)
    references public.stock_request_lines (id, organization_id) on delete restrict,
  add constraint stock_transfer_lines_short_quantity_bounds check (short_quantity >= 0 and received_quantity + short_quantity <= quantity);
create index stock_transfer_lines_request_line_idx on public.stock_transfer_lines (stock_request_line_id) where stock_request_line_id is not null;

create table public.stock_request_discrepancies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  stock_request_id uuid not null,
  stock_request_line_id uuid not null,
  stock_transfer_line_id uuid not null,
  short_quantity numeric(14,3) not null,
  note text not null,
  reported_by_employee_id uuid not null,
  reported_at timestamptz not null default now(),
  constraint stock_request_discrepancies_request_organization_fkey foreign key (stock_request_id, organization_id)
    references public.stock_requests (id, organization_id) on delete restrict,
  constraint stock_request_discrepancies_request_line_organization_fkey foreign key (stock_request_line_id, organization_id)
    references public.stock_request_lines (id, organization_id) on delete restrict,
  constraint stock_request_discrepancies_transfer_line_organization_fkey foreign key (stock_transfer_line_id, organization_id)
    references public.stock_transfer_lines (id, organization_id) on delete restrict,
  constraint stock_request_discrepancies_employee_organization_fkey foreign key (reported_by_employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict,
  constraint stock_request_discrepancies_quantity_positive check (short_quantity > 0),
  constraint stock_request_discrepancies_note_length check (char_length(btrim(note)) between 2 and 500)
);
create index stock_request_discrepancies_request_reported_idx
  on public.stock_request_discrepancies (stock_request_id, reported_at desc);

alter table public.supply_chain_warehouses enable row level security;
alter table public.inventory_replenishment_rules enable row level security;
alter table public.stock_requests enable row level security;
alter table public.stock_request_lines enable row level security;
alter table public.stock_request_discrepancies enable row level security;

revoke all on table public.supply_chain_warehouses, public.inventory_replenishment_rules, public.stock_requests, public.stock_request_lines, public.stock_request_discrepancies from public, anon, authenticated, service_role;
grant select on table public.supply_chain_warehouses, public.inventory_replenishment_rules, public.stock_requests, public.stock_request_lines, public.stock_request_discrepancies to authenticated;

create policy supply_chain_warehouses_select_inventory_manager on public.supply_chain_warehouses for select to authenticated using ((select private.has_permission(organization_id, 'inventory.manage')));
create policy inventory_replenishment_rules_select_inventory_manager on public.inventory_replenishment_rules for select to authenticated using ((select private.has_permission(organization_id, 'inventory.manage')));
create policy stock_requests_select_inventory_manager on public.stock_requests for select to authenticated using ((select private.has_permission(organization_id, 'inventory.manage')));
create policy stock_request_lines_select_inventory_manager on public.stock_request_lines for select to authenticated using ((select private.has_permission(organization_id, 'inventory.manage')));
create policy stock_request_discrepancies_select_inventory_manager on public.stock_request_discrepancies for select to authenticated using ((select private.has_permission(organization_id, 'inventory.manage')));

create or replace function private.create_supply_chain_warehouse(
  target_organization_id uuid, target_store_id uuid, target_code text, target_name text, target_notes text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid; warehouse_id uuid;
begin
  if (select auth.uid()) is null or not (select private.has_permission(target_organization_id, 'inventory.manage')) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;
  if target_code is null or upper(btrim(target_code)) !~ '^[A-Z][A-Z0-9_-]{1,39}$'
    or target_name is null or char_length(btrim(target_name)) not between 2 and 120
    or (target_notes is not null and char_length(btrim(target_notes)) > 500) then
    raise exception 'Provide a warehouse code, name, and valid notes.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.stores store where store.id = target_store_id and store.organization_id = target_organization_id and store.is_active) then
    raise exception 'Choose an active store stock location for this warehouse.' using errcode = '23514';
  end if;
  actor_id := private.inventory_actor(target_organization_id, target_store_id);
  if actor_id is null then raise exception 'An assigned employee is required for the warehouse store.' using errcode = '42501'; end if;
  insert into public.supply_chain_warehouses (organization_id, store_id, code, name, notes, created_by_employee_id)
  values (target_organization_id, target_store_id, upper(btrim(target_code)), btrim(target_name), nullif(btrim(target_notes), ''), actor_id)
  returning id into warehouse_id;
  perform private.write_audit_log(target_organization_id, 'SUPPLY_CHAIN_WAREHOUSE_CREATED', 'inventory.manage', actor_id, null, target_store_id, null, null, null, null, jsonb_build_object('warehouse_id', warehouse_id));
  return warehouse_id;
end;
$$;
create or replace function public.create_supply_chain_warehouse(target_organization_id uuid, target_store_id uuid, target_code text, target_name text, target_notes text)
returns uuid language sql security invoker set search_path = '' as $$
  select private.create_supply_chain_warehouse(target_organization_id, target_store_id, target_code, target_name, target_notes);
$$;

create or replace function private.update_supplier_lead_time(target_organization_id uuid, target_supplier_id uuid, target_lead_time_days integer)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid;
begin
  if (select auth.uid()) is null or not (select private.has_permission(target_organization_id, 'inventory.manage')) then raise exception 'Inventory permission is required.' using errcode = '42501'; end if;
  if target_lead_time_days is null or target_lead_time_days not between 0 and 365 then raise exception 'Supplier lead time must be between zero and 365 days.' using errcode = '23514'; end if;
  if not exists (select 1 from public.suppliers supplier where supplier.id = target_supplier_id and supplier.organization_id = target_organization_id) then raise exception 'Choose a supplier in this organization.' using errcode = '23514'; end if;
  select employee.id into actor_id from public.employees employee where employee.organization_id = target_organization_id and employee.profile_id = (select auth.uid()) and employee.status = 'active' order by employee.created_at limit 1;
  if actor_id is null then raise exception 'An active employee record is required.' using errcode = '42501'; end if;
  update public.suppliers set lead_time_days = target_lead_time_days where id = target_supplier_id and organization_id = target_organization_id;
  perform private.write_audit_log(target_organization_id, 'SUPPLIER_LEAD_TIME_UPDATED', 'inventory.manage', actor_id, null, null, null, null, null, null, jsonb_build_object('supplier_id', target_supplier_id, 'lead_time_days', target_lead_time_days));
end;
$$;
create or replace function public.update_supplier_lead_time(target_organization_id uuid, target_supplier_id uuid, target_lead_time_days integer)
returns void language sql security invoker set search_path = '' as $$
  select private.update_supplier_lead_time(target_organization_id, target_supplier_id, target_lead_time_days);
$$;

create or replace function private.upsert_inventory_replenishment_rule(
  target_organization_id uuid, target_store_id uuid, target_product_id uuid, target_variant_id uuid,
  target_preferred_warehouse_id uuid, target_reorder_point numeric, target_target_stock numeric
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid; rule_id uuid; warehouse_store_id uuid;
begin
  if (select auth.uid()) is null or not (select private.has_permission(target_organization_id, 'inventory.manage')) then raise exception 'Inventory permission is required.' using errcode = '42501'; end if;
  if target_reorder_point is null or target_target_stock is null or target_reorder_point < 0 or target_target_stock <= 0 or target_target_stock < target_reorder_point or target_reorder_point <> round(target_reorder_point, 3) or target_target_stock <> round(target_target_stock, 3) then raise exception 'Reorder point and target stock must be valid quantities.' using errcode = '23514'; end if;
  actor_id := private.inventory_actor(target_organization_id, target_store_id);
  if actor_id is null then raise exception 'An assigned employee is required for the requesting store.' using errcode = '42501'; end if;
  if not exists (select 1 from public.inventory_levels level where level.organization_id = target_organization_id and level.store_id = target_store_id and level.product_id = target_product_id and level.variant_id is not distinct from target_variant_id) then raise exception 'Initialize the destination stock projection before setting a replenishment rule.' using errcode = '23514'; end if;
  if not exists (select 1 from public.products product left join public.product_variants variant on variant.id = target_variant_id and variant.product_id = product.id and variant.organization_id = product.organization_id where product.id = target_product_id and product.organization_id = target_organization_id and product.status = 'active' and product.track_inventory and (target_variant_id is null or variant.id is not null)) then raise exception 'Choose an active tracked saleable item.' using errcode = '23514'; end if;
  if target_preferred_warehouse_id is not null then
    select warehouse.store_id into warehouse_store_id from public.supply_chain_warehouses warehouse where warehouse.id = target_preferred_warehouse_id and warehouse.organization_id = target_organization_id and warehouse.is_active;
    if warehouse_store_id is null or warehouse_store_id = target_store_id then raise exception 'Choose an active warehouse at a different stock location.' using errcode = '23514'; end if;
  end if;
  insert into public.inventory_replenishment_rules (organization_id, store_id, product_id, variant_id, preferred_warehouse_id, reorder_point, target_stock, updated_by_employee_id)
  values (target_organization_id, target_store_id, target_product_id, target_variant_id, target_preferred_warehouse_id, target_reorder_point, target_target_stock, actor_id)
  on conflict (organization_id, store_id, product_id, variant_id) do update set preferred_warehouse_id = excluded.preferred_warehouse_id, reorder_point = excluded.reorder_point, target_stock = excluded.target_stock, updated_by_employee_id = excluded.updated_by_employee_id, updated_at = now()
  returning id into rule_id;
  perform private.write_audit_log(target_organization_id, 'INVENTORY_REPLENISHMENT_RULE_SAVED', 'inventory.manage', actor_id, null, target_store_id, null, null, null, null, jsonb_build_object('rule_id', rule_id, 'product_id', target_product_id, 'variant_id', target_variant_id, 'reorder_point', target_reorder_point, 'target_stock', target_target_stock));
  return rule_id;
end;
$$;
create or replace function public.upsert_inventory_replenishment_rule(target_organization_id uuid, target_store_id uuid, target_product_id uuid, target_variant_id uuid, target_preferred_warehouse_id uuid, target_reorder_point numeric, target_target_stock numeric)
returns uuid language sql security invoker set search_path = '' as $$
  select private.upsert_inventory_replenishment_rule(target_organization_id, target_store_id, target_product_id, target_variant_id, target_preferred_warehouse_id, target_reorder_point, target_target_stock);
$$;

create or replace function private.create_stock_request(
  target_organization_id uuid, target_requesting_store_id uuid, target_source_warehouse_id uuid, target_note text, target_lines jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid; request_id uuid; request_number bigint; line jsonb; product_row record; warehouse_store_id uuid;
begin
  if (select auth.uid()) is null or not (select private.has_permission(target_organization_id, 'inventory.manage')) then raise exception 'Inventory permission is required.' using errcode = '42501'; end if;
  if target_lines is null or jsonb_typeof(target_lines) <> 'array' or jsonb_array_length(target_lines) not between 1 and 100 or (target_note is not null and char_length(btrim(target_note)) > 500) then raise exception 'A stock request needs one to 100 items and valid notes.' using errcode = '23514'; end if;
  if exists (select 1 from jsonb_array_elements(target_lines) requested(value) where jsonb_typeof(requested.value) <> 'object' or coalesce(requested.value->>'product_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or (requested.value ? 'variant_id' and requested.value->'variant_id' <> 'null'::jsonb and coalesce(requested.value->>'variant_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') or coalesce(requested.value->>'quantity','') !~ '^\d+(\.\d{1,3})?$' or (requested.value->>'quantity')::numeric <= 0) then raise exception 'Request lines need active items and positive quantities.' using errcode = '23514'; end if;
  if (select count(*) from jsonb_array_elements(target_lines)) <> (select count(distinct (value->>'product_id') || ':' || coalesce(value->>'variant_id','')) from jsonb_array_elements(target_lines)) then raise exception 'Each request item can appear only once.' using errcode = '23514'; end if;
  actor_id := private.inventory_actor(target_organization_id, target_requesting_store_id);
  if actor_id is null then raise exception 'An assigned employee is required for the requesting store.' using errcode = '42501'; end if;
  select warehouse.store_id into warehouse_store_id from public.supply_chain_warehouses warehouse where warehouse.id = target_source_warehouse_id and warehouse.organization_id = target_organization_id and warehouse.is_active;
  if warehouse_store_id is null or warehouse_store_id = target_requesting_store_id then raise exception 'Choose an active warehouse at a different stock location.' using errcode = '23514'; end if;
  request_number := nextval('private.tindio_stock_request_number_sequence'::regclass);
  insert into public.stock_requests (organization_id, request_number, requesting_store_id, source_warehouse_id, note, requested_by_employee_id)
  values (target_organization_id, request_number, target_requesting_store_id, target_source_warehouse_id, nullif(btrim(target_note), ''), actor_id)
  returning id into request_id;
  for line in select value from jsonb_array_elements(target_lines) order by value->>'product_id', coalesce(value->>'variant_id','') loop
    select product.name as product_name, variant.name as variant_name, product.unit into product_row
    from public.products product left join public.product_variants variant on variant.id = nullif(line->>'variant_id','')::uuid and variant.product_id = product.id and variant.organization_id = product.organization_id
    where product.id = (line->>'product_id')::uuid and product.organization_id = target_organization_id and product.status = 'active' and product.track_inventory and (nullif(line->>'variant_id','') is null or variant.id is not null);
    if not found then raise exception 'Every request item must be an active tracked product.' using errcode = '23514'; end if;
    if not exists (select 1 from public.inventory_levels level where level.organization_id = target_organization_id and level.store_id = target_requesting_store_id and level.product_id = (line->>'product_id')::uuid and level.variant_id is not distinct from nullif(line->>'variant_id','')::uuid) then raise exception 'Initialize the destination stock projection for every requested item.' using errcode = '23514'; end if;
    insert into public.stock_request_lines (organization_id, stock_request_id, product_id, variant_id, product_name_snapshot, variant_name_snapshot, unit_snapshot, requested_quantity)
    values (target_organization_id, request_id, (line->>'product_id')::uuid, nullif(line->>'variant_id','')::uuid, product_row.product_name, product_row.variant_name, product_row.unit, (line->>'quantity')::numeric(14,3));
  end loop;
  perform private.write_audit_log(target_organization_id, 'STOCK_REQUEST_SUBMITTED', 'inventory.manage', actor_id, null, target_requesting_store_id, null, null, null, target_note, jsonb_build_object('stock_request_id', request_id, 'source_warehouse_id', target_source_warehouse_id));
  return request_id;
end;
$$;
create or replace function public.create_stock_request(target_organization_id uuid, target_requesting_store_id uuid, target_source_warehouse_id uuid, target_note text, target_lines jsonb)
returns uuid language sql security invoker set search_path = '' as $$
  select private.create_stock_request(target_organization_id, target_requesting_store_id, target_source_warehouse_id, target_note, target_lines);
$$;

create or replace function private.approve_stock_request(target_organization_id uuid, target_stock_request_id uuid, target_lines jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare request_row public.stock_requests%rowtype; actor_id uuid; line jsonb; request_line public.stock_request_lines%rowtype; warehouse_store_id uuid;
begin
  if (select auth.uid()) is null or not (select private.has_permission(target_organization_id, 'inventory.manage')) then raise exception 'Inventory permission is required.' using errcode = '42501'; end if;
  if target_lines is null or jsonb_typeof(target_lines) <> 'array' or jsonb_array_length(target_lines) not between 1 and 100 then raise exception 'Approval needs every request line.' using errcode = '23514'; end if;
  select * into request_row from public.stock_requests request where request.id = target_stock_request_id and request.organization_id = target_organization_id and request.status = 'requested' for update;
  if request_row.id is null then raise exception 'Only a submitted request can be approved.' using errcode = '23514'; end if;
  select warehouse.store_id into warehouse_store_id from public.supply_chain_warehouses warehouse where warehouse.id = request_row.source_warehouse_id and warehouse.organization_id = target_organization_id and warehouse.is_active;
  actor_id := private.inventory_actor(target_organization_id, warehouse_store_id);
  if actor_id is null then raise exception 'An assigned employee is required for the source warehouse.' using errcode = '42501'; end if;
  if (select count(*) from public.stock_request_lines where stock_request_id = request_row.id) <> jsonb_array_length(target_lines)
    or exists (select 1 from jsonb_array_elements(target_lines) approval(value) where jsonb_typeof(approval.value) <> 'object' or coalesce(approval.value->>'stock_request_line_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or coalesce(approval.value->>'approved_quantity','') !~ '^\d+(\.\d{1,3})?$')
    or (select count(*) from jsonb_array_elements(target_lines)) <> (select count(distinct value->>'stock_request_line_id') from jsonb_array_elements(target_lines)) then raise exception 'Approval lines are invalid.' using errcode = '23514'; end if;
  for line in select value from jsonb_array_elements(target_lines) loop
    select * into request_line from public.stock_request_lines item where item.id = (line->>'stock_request_line_id')::uuid and item.stock_request_id = request_row.id and item.organization_id = target_organization_id for update;
    if request_line.id is null or (line->>'approved_quantity')::numeric > request_line.requested_quantity then raise exception 'Approved quantity cannot exceed the request.' using errcode = '23514'; end if;
    update public.stock_request_lines set approved_quantity = (line->>'approved_quantity')::numeric(14,3) where id = request_line.id;
  end loop;
  if not exists (select 1 from public.stock_request_lines where stock_request_id = request_row.id and approved_quantity > 0) then raise exception 'Approve at least one requested quantity.' using errcode = '23514'; end if;
  update public.stock_requests set status = 'approved', approved_by_employee_id = actor_id, approved_at = now() where id = request_row.id;
  perform private.write_audit_log(target_organization_id, 'STOCK_REQUEST_APPROVED', 'inventory.manage', actor_id, null, request_row.requesting_store_id, null, null, null, null, jsonb_build_object('stock_request_id', request_row.id));
end;
$$;
create or replace function public.approve_stock_request(target_organization_id uuid, target_stock_request_id uuid, target_lines jsonb)
returns void language sql security invoker set search_path = '' as $$
  select private.approve_stock_request(target_organization_id, target_stock_request_id, target_lines);
$$;

create or replace function private.start_stock_request_picking(target_organization_id uuid, target_stock_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare request_row public.stock_requests%rowtype; actor_id uuid; warehouse_store_id uuid;
begin
  if (select auth.uid()) is null or not (select private.has_permission(target_organization_id, 'inventory.manage')) then raise exception 'Inventory permission is required.' using errcode = '42501'; end if;
  select * into request_row from public.stock_requests request where request.id = target_stock_request_id and request.organization_id = target_organization_id and request.status = 'approved' for update;
  if request_row.id is null then raise exception 'Only an approved request can be picked.' using errcode = '23514'; end if;
  select warehouse.store_id into warehouse_store_id from public.supply_chain_warehouses warehouse where warehouse.id = request_row.source_warehouse_id and warehouse.organization_id = target_organization_id and warehouse.is_active;
  actor_id := private.inventory_actor(target_organization_id, warehouse_store_id);
  if actor_id is null then raise exception 'An assigned employee is required for the source warehouse.' using errcode = '42501'; end if;
  update public.stock_request_lines set picked_quantity = approved_quantity where stock_request_id = request_row.id;
  update public.stock_requests set status = 'picking', picked_by_employee_id = actor_id, picked_at = now() where id = request_row.id;
  perform private.write_audit_log(target_organization_id, 'STOCK_REQUEST_PICKING_STARTED', 'inventory.manage', actor_id, null, warehouse_store_id, null, null, null, null, jsonb_build_object('stock_request_id', request_row.id));
end;
$$;
create or replace function public.start_stock_request_picking(target_organization_id uuid, target_stock_request_id uuid)
returns void language sql security invoker set search_path = '' as $$
  select private.start_stock_request_picking(target_organization_id, target_stock_request_id);
$$;

create or replace function private.dispatch_stock_request(target_organization_id uuid, target_stock_request_id uuid, target_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare request_row public.stock_requests%rowtype; actor_id uuid; warehouse_store_id uuid; transfer_id uuid; request_line public.stock_request_lines%rowtype; source_level public.inventory_levels%rowtype;
begin
  if (select auth.uid()) is null or not (select private.has_permission(target_organization_id, 'inventory.manage')) then raise exception 'Inventory permission is required.' using errcode = '42501'; end if;
  if target_note is not null and char_length(btrim(target_note)) > 500 then raise exception 'Dispatch note is too long.' using errcode = '23514'; end if;
  select * into request_row from public.stock_requests request where request.id = target_stock_request_id and request.organization_id = target_organization_id and request.status = 'picking' for update;
  if request_row.id is null then raise exception 'Only a picked request can be dispatched.' using errcode = '23514'; end if;
  select warehouse.store_id into warehouse_store_id from public.supply_chain_warehouses warehouse where warehouse.id = request_row.source_warehouse_id and warehouse.organization_id = target_organization_id and warehouse.is_active;
  actor_id := private.inventory_actor(target_organization_id, warehouse_store_id);
  if actor_id is null then raise exception 'An assigned employee is required for the source warehouse.' using errcode = '42501'; end if;
  insert into public.stock_transfers (organization_id, source_store_id, destination_store_id, stock_request_id, status, note, transferred_by_employee_id)
  values (target_organization_id, warehouse_store_id, request_row.requesting_store_id, request_row.id, 'in_transit', coalesce(nullif(btrim(target_note), ''), request_row.note), actor_id)
  returning id into transfer_id;
  for request_line in select * from public.stock_request_lines item where item.stock_request_id = request_row.id and item.picked_quantity > 0 order by item.product_id, item.variant_id loop
    select * into source_level from public.inventory_levels level where level.organization_id = target_organization_id and level.store_id = warehouse_store_id and level.product_id = request_line.product_id and level.variant_id is not distinct from request_line.variant_id for update;
    if source_level.id is null or source_level.quantity < request_line.picked_quantity then raise exception 'Source warehouse stock is insufficient for this request.' using errcode = '23514'; end if;
    if not exists (select 1 from public.inventory_levels level where level.organization_id = target_organization_id and level.store_id = request_row.requesting_store_id and level.product_id = request_line.product_id and level.variant_id is not distinct from request_line.variant_id) then raise exception 'The destination stock projection is not initialized for one requested item.' using errcode = '23514'; end if;
    insert into public.stock_transfer_lines (organization_id, stock_transfer_id, stock_request_line_id, product_id, variant_id, quantity, unit_cost_minor)
    values (target_organization_id, transfer_id, request_line.id, request_line.product_id, request_line.variant_id, request_line.picked_quantity, source_level.average_cost_minor);
    perform private.apply_inventory_change_v2(target_organization_id, warehouse_store_id, request_line.product_id, request_line.variant_id, -request_line.picked_quantity, 'TRANSFER_OUT', actor_id, 'Stock request dispatched', 'stock_transfer', transfer_id, source_level.average_cost_minor);
    update public.stock_request_lines set dispatched_quantity = request_line.picked_quantity where id = request_line.id;
  end loop;
  update public.stock_requests set status = 'dispatched', dispatched_by_employee_id = actor_id, dispatched_at = now() where id = request_row.id;
  perform private.write_audit_log(target_organization_id, 'STOCK_REQUEST_DISPATCHED', 'inventory.manage', actor_id, null, warehouse_store_id, null, null, null, target_note, jsonb_build_object('stock_request_id', request_row.id, 'stock_transfer_id', transfer_id, 'destination_store_id', request_row.requesting_store_id));
  return transfer_id;
end;
$$;
create or replace function public.dispatch_stock_request(target_organization_id uuid, target_stock_request_id uuid, target_note text)
returns uuid language sql security invoker set search_path = '' as $$
  select private.dispatch_stock_request(target_organization_id, target_stock_request_id, target_note);
$$;

create or replace function private.receive_stock_request(target_organization_id uuid, target_stock_request_id uuid, target_lines jsonb, target_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare request_row public.stock_requests%rowtype; actor_id uuid; transfer_row public.stock_transfers%rowtype; receipt_id uuid; line jsonb; transfer_line public.stock_transfer_lines%rowtype; request_line public.stock_request_lines%rowtype; received_now numeric(14,3); short_now numeric(14,3); remaining numeric(14,3); total_remaining numeric(14,3); has_shortage boolean;
begin
  if (select auth.uid()) is null or not (select private.has_permission(target_organization_id, 'inventory.manage')) then raise exception 'Inventory permission is required.' using errcode = '42501'; end if;
  if target_lines is null or jsonb_typeof(target_lines) <> 'array' or jsonb_array_length(target_lines) not between 1 and 100 or (target_note is not null and char_length(btrim(target_note)) > 500) then raise exception 'A receipt needs one to 100 lines and valid notes.' using errcode = '23514'; end if;
  select * into request_row from public.stock_requests request where request.id = target_stock_request_id and request.organization_id = target_organization_id and request.status in ('dispatched', 'partially_received') for update;
  if request_row.id is null then raise exception 'This request is not available for receiving.' using errcode = '23514'; end if;
  actor_id := private.inventory_actor(target_organization_id, request_row.requesting_store_id);
  if actor_id is null then raise exception 'An assigned employee is required for the requesting store.' using errcode = '42501'; end if;
  select * into transfer_row from public.stock_transfers transfer where transfer.organization_id = target_organization_id and transfer.stock_request_id = request_row.id and transfer.status in ('in_transit', 'partially_received') for update;
  if transfer_row.id is null then raise exception 'The dispatched stock transfer is unavailable.' using errcode = '23514'; end if;
  if exists (select 1 from jsonb_array_elements(target_lines) receipt(value) where jsonb_typeof(receipt.value) <> 'object' or coalesce(receipt.value->>'stock_transfer_line_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or coalesce(receipt.value->>'received_quantity','') !~ '^\d+(\.\d{1,3})?$' or coalesce(receipt.value->>'short_quantity','') !~ '^\d+(\.\d{1,3})?$' or ((receipt.value->>'received_quantity')::numeric + (receipt.value->>'short_quantity')::numeric) <= 0 or ((receipt.value->>'short_quantity')::numeric > 0 and char_length(btrim(coalesce(receipt.value->>'discrepancy_note', ''))) not between 2 and 500)) or (select count(*) from jsonb_array_elements(target_lines)) <> (select count(distinct value->>'stock_transfer_line_id') from jsonb_array_elements(target_lines)) then raise exception 'Receipt lines, quantities, and discrepancy notes are invalid.' using errcode = '23514'; end if;
  for line in select value from jsonb_array_elements(target_lines) loop
    select * into transfer_line from public.stock_transfer_lines item where item.id = (line->>'stock_transfer_line_id')::uuid and item.stock_transfer_id = transfer_row.id and item.organization_id = target_organization_id and item.stock_request_line_id is not null for update;
    if transfer_line.id is null then raise exception 'A receipt line does not belong to this stock request.' using errcode = '23514'; end if;
    select * into request_line from public.stock_request_lines item where item.id = transfer_line.stock_request_line_id and item.stock_request_id = request_row.id and item.organization_id = target_organization_id for update;
    received_now := (line->>'received_quantity')::numeric(14,3); short_now := (line->>'short_quantity')::numeric(14,3); remaining := transfer_line.quantity - transfer_line.received_quantity - transfer_line.short_quantity;
    if received_now + short_now > remaining then raise exception 'Received and short quantities cannot exceed the remaining dispatched quantity.' using errcode = '23514'; end if;
    if received_now > 0 then
      if receipt_id is null then
        insert into public.stock_transfer_receipts (organization_id, stock_transfer_id, destination_store_id, received_by_employee_id, note)
        values (target_organization_id, transfer_row.id, request_row.requesting_store_id, actor_id, nullif(btrim(target_note), '')) returning id into receipt_id;
      end if;
      insert into public.stock_transfer_receipt_lines (organization_id, stock_transfer_receipt_id, stock_transfer_line_id, quantity_received)
      values (target_organization_id, receipt_id, transfer_line.id, received_now);
      perform private.apply_inventory_change_v2(target_organization_id, request_row.requesting_store_id, transfer_line.product_id, transfer_line.variant_id, received_now, 'TRANSFER_IN', actor_id, 'Stock request received', 'stock_transfer_receipt', receipt_id, transfer_line.unit_cost_minor);
    end if;
    update public.stock_transfer_lines set received_quantity = received_quantity + received_now, short_quantity = short_quantity + short_now where id = transfer_line.id;
    update public.stock_request_lines set received_quantity = received_quantity + received_now, short_quantity = short_quantity + short_now where id = request_line.id;
    if short_now > 0 then
      insert into public.stock_request_discrepancies (organization_id, stock_request_id, stock_request_line_id, stock_transfer_line_id, short_quantity, note, reported_by_employee_id)
      values (target_organization_id, request_row.id, request_line.id, transfer_line.id, short_now, btrim(line->>'discrepancy_note'), actor_id);
    end if;
  end loop;
  select coalesce(sum(quantity - received_quantity - short_quantity), 0) into total_remaining from public.stock_transfer_lines where stock_transfer_id = transfer_row.id;
  select exists (select 1 from public.stock_transfer_lines where stock_transfer_id = transfer_row.id and short_quantity > 0) into has_shortage;
  update public.stock_transfers set status = case when total_remaining = 0 then 'completed' else 'partially_received' end, received_by_employee_id = actor_id, received_at = now(), completed_at = case when total_remaining = 0 then now() else completed_at end where id = transfer_row.id;
  update public.stock_requests set status = case when total_remaining > 0 then 'partially_received' when has_shortage then 'received_with_discrepancy' else 'received' end, received_by_employee_id = actor_id, received_at = case when total_remaining = 0 then now() else received_at end where id = request_row.id;
  perform private.write_audit_log(target_organization_id, case when total_remaining = 0 then 'STOCK_REQUEST_RECEIVED' else 'STOCK_REQUEST_PARTIALLY_RECEIVED' end, 'inventory.manage', actor_id, null, request_row.requesting_store_id, null, null, null, target_note, jsonb_build_object('stock_request_id', request_row.id, 'stock_transfer_id', transfer_row.id, 'receipt_id', receipt_id, 'remaining_quantity', total_remaining, 'has_discrepancy', has_shortage));
  return request_row.id;
end;
$$;
create or replace function public.receive_stock_request(target_organization_id uuid, target_stock_request_id uuid, target_lines jsonb, target_note text)
returns uuid language sql security invoker set search_path = '' as $$
  select private.receive_stock_request(target_organization_id, target_stock_request_id, target_lines, target_note);
$$;

-- Keep direct-transfer receiving compatible while considering any short amount
-- registered by the replenishment workflow.
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
  actor_id := private.inventory_actor(target_organization_id, transfer.destination_store_id); if actor_id is null then raise exception 'An assigned employee is required for the destination store.' using errcode = '42501'; end if;
  insert into public.stock_transfer_receipts (organization_id, stock_transfer_id, destination_store_id, received_by_employee_id, note) values (target_organization_id, transfer.id, transfer.destination_store_id, actor_id, nullif(btrim(target_note), '')) returning id into receipt_id;
  for line in select value from jsonb_array_elements(target_lines) loop
    if coalesce(line->>'stock_transfer_line_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or coalesce(line->>'quantity','') !~ '^\d+(\.\d{1,3})?$' or (line->>'quantity')::numeric <= 0 then raise exception 'Receipt lines must include a valid transfer line and positive quantity.' using errcode = '23514'; end if;
    select * into transfer_line from public.stock_transfer_lines item where item.id = (line->>'stock_transfer_line_id')::uuid and item.stock_transfer_id = transfer.id and item.organization_id = target_organization_id for update;
    if transfer_line.id is null then raise exception 'A receipt line does not belong to this transfer.' using errcode = '23514'; end if;
    line_quantity := (line->>'quantity')::numeric(14,3); remaining := transfer_line.quantity - transfer_line.received_quantity - transfer_line.short_quantity;
    if line_quantity > remaining then raise exception 'Received transfer quantity cannot exceed the remaining quantity.' using errcode = '23514'; end if;
    insert into public.stock_transfer_receipt_lines (organization_id, stock_transfer_receipt_id, stock_transfer_line_id, quantity_received) values (target_organization_id, receipt_id, transfer_line.id, line_quantity);
    update public.stock_transfer_lines set received_quantity = received_quantity + line_quantity where id = transfer_line.id;
    perform private.apply_inventory_change_v2(target_organization_id, transfer.destination_store_id, transfer_line.product_id, transfer_line.variant_id, line_quantity, 'TRANSFER_IN', actor_id, 'Stock transfer received', 'stock_transfer_receipt', receipt_id, transfer_line.unit_cost_minor);
  end loop;
  select coalesce(sum(quantity - received_quantity - short_quantity), 0) into total_remaining from public.stock_transfer_lines where stock_transfer_id = transfer.id;
  update public.stock_transfers set status = case when total_remaining = 0 then 'completed' else 'partially_received' end, received_by_employee_id = actor_id, received_at = now(), completed_at = case when total_remaining = 0 then now() else completed_at end where id = transfer.id;
  perform private.write_audit_log(target_organization_id, 'STOCK_TRANSFER_RECEIVED', 'inventory.manage', actor_id, null, transfer.destination_store_id, null, null, null, target_note, jsonb_build_object('transfer_id', transfer.id, 'receipt_id', receipt_id, 'remaining_quantity', total_remaining));
  return receipt_id;
end;
$$;

revoke execute on function private.create_supply_chain_warehouse(uuid,uuid,text,text,text), private.update_supplier_lead_time(uuid,uuid,integer), private.upsert_inventory_replenishment_rule(uuid,uuid,uuid,uuid,uuid,numeric,numeric), private.create_stock_request(uuid,uuid,uuid,text,jsonb), private.approve_stock_request(uuid,uuid,jsonb), private.start_stock_request_picking(uuid,uuid), private.dispatch_stock_request(uuid,uuid,text), private.receive_stock_request(uuid,uuid,jsonb,text) from public, anon, service_role;
revoke execute on function private.default_purchase_order_expected_at_from_supplier() from public, anon, authenticated, service_role;
revoke execute on function public.create_supply_chain_warehouse(uuid,uuid,text,text,text), public.update_supplier_lead_time(uuid,uuid,integer), public.upsert_inventory_replenishment_rule(uuid,uuid,uuid,uuid,uuid,numeric,numeric), public.create_stock_request(uuid,uuid,uuid,text,jsonb), public.approve_stock_request(uuid,uuid,jsonb), public.start_stock_request_picking(uuid,uuid), public.dispatch_stock_request(uuid,uuid,text), public.receive_stock_request(uuid,uuid,jsonb,text) from public, anon, service_role;
grant execute on function private.create_supply_chain_warehouse(uuid,uuid,text,text,text), private.update_supplier_lead_time(uuid,uuid,integer), private.upsert_inventory_replenishment_rule(uuid,uuid,uuid,uuid,uuid,numeric,numeric), private.create_stock_request(uuid,uuid,uuid,text,jsonb), private.approve_stock_request(uuid,uuid,jsonb), private.start_stock_request_picking(uuid,uuid), private.dispatch_stock_request(uuid,uuid,text), private.receive_stock_request(uuid,uuid,jsonb,text) to authenticated;
grant execute on function public.create_supply_chain_warehouse(uuid,uuid,text,text,text), public.update_supplier_lead_time(uuid,uuid,integer), public.upsert_inventory_replenishment_rule(uuid,uuid,uuid,uuid,uuid,numeric,numeric), public.create_stock_request(uuid,uuid,uuid,text,jsonb), public.approve_stock_request(uuid,uuid,jsonb), public.start_stock_request_picking(uuid,uuid), public.dispatch_stock_request(uuid,uuid,text), public.receive_stock_request(uuid,uuid,jsonb,text) to authenticated;

comment on table public.stock_requests is 'A multi-store replenishment request. It does not change stock until its approved pick is dispatched.';
comment on table public.stock_request_discrepancies is 'Immutable short/damaged quantities reported while receiving a stock request; shortages never create destination stock.';
comment on column public.stock_transfer_lines.short_quantity is 'Dispatched quantity formally reported short. It completes the physical transfer without crediting destination stock.';
commit;
