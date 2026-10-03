-- TINDIO Phase 9: supplier procurement and multi-store inventory operations.
begin;

create sequence private.tindio_purchase_order_number_sequence as bigint start with 1;

create table public.suppliers (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null, contact_name text, email text, phone text, address text, notes text, is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint suppliers_id_organization_unique unique (id, organization_id),
  constraint suppliers_name_length check (char_length(btrim(name)) between 1 and 160),
  constraint suppliers_email_length check (email is null or char_length(email) <= 320),
  constraint suppliers_phone_length check (phone is null or char_length(phone) <= 40),
  constraint suppliers_address_length check (address is null or char_length(address) <= 1000),
  constraint suppliers_notes_length check (notes is null or char_length(notes) <= 2000)
);
create unique index suppliers_organization_name_unique_idx on public.suppliers (organization_id, lower(btrim(name)));

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations (id) on delete restrict,
  store_id uuid not null, supplier_id uuid not null, order_number bigint not null, status text not null default 'draft', notes text,
  ordered_at timestamptz, expected_at date, received_at timestamptz, created_by_employee_id uuid not null, received_by_employee_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint purchase_orders_id_organization_unique unique (id, organization_id),
  constraint purchase_orders_store_organization_fkey foreign key (store_id, organization_id) references public.stores (id, organization_id) on delete restrict,
  constraint purchase_orders_supplier_organization_fkey foreign key (supplier_id, organization_id) references public.suppliers (id, organization_id) on delete restrict,
  constraint purchase_orders_creator_organization_fkey foreign key (created_by_employee_id, organization_id) references public.employees (id, organization_id) on delete restrict,
  constraint purchase_orders_receiver_organization_fkey foreign key (received_by_employee_id, organization_id) references public.employees (id, organization_id) on delete restrict,
  constraint purchase_orders_org_number_unique unique (organization_id, order_number),
  constraint purchase_orders_status_values check (status in ('draft','ordered','partially_received','received','cancelled')),
  constraint purchase_orders_notes_length check (notes is null or char_length(notes) <= 1000),
  constraint purchase_orders_received_state check ((status in ('received','partially_received') and received_at is not null and received_by_employee_id is not null) or (status not in ('received','partially_received')))
);
create index purchase_orders_organization_store_status_created_idx on public.purchase_orders (organization_id, store_id, status, created_at desc);

create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, purchase_order_id uuid not null, product_id uuid not null, variant_id uuid,
  product_name_snapshot text not null, variant_name_snapshot text, unit_snapshot text not null, ordered_quantity numeric(14,3) not null, received_quantity numeric(14,3) not null default 0, unit_cost_minor bigint not null default 0,
  constraint purchase_order_lines_order_organization_fkey foreign key (purchase_order_id, organization_id) references public.purchase_orders (id, organization_id) on delete restrict,
  constraint purchase_order_lines_product_organization_fkey foreign key (product_id, organization_id) references public.products (id, organization_id) on delete restrict,
  constraint purchase_order_lines_variant_product_organization_fkey foreign key (variant_id, product_id, organization_id) references public.product_variants (id, product_id, organization_id) on delete restrict,
  constraint purchase_order_lines_saleable_unique unique (purchase_order_id, product_id, variant_id),
  constraint purchase_order_lines_quantity_bounds check (ordered_quantity > 0 and received_quantity >= 0 and received_quantity <= ordered_quantity),
  constraint purchase_order_lines_cost_nonnegative check (unit_cost_minor >= 0)
);
create index purchase_order_lines_order_idx on public.purchase_order_lines (purchase_order_id);

create table public.goods_receipts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations (id) on delete restrict,
  purchase_order_id uuid not null, store_id uuid not null, received_by_employee_id uuid not null, note text, received_at timestamptz not null default now(),
  constraint goods_receipts_id_organization_unique unique (id, organization_id),
  constraint goods_receipts_order_organization_fkey foreign key (purchase_order_id, organization_id) references public.purchase_orders (id, organization_id) on delete restrict,
  constraint goods_receipts_store_organization_fkey foreign key (store_id, organization_id) references public.stores (id, organization_id) on delete restrict,
  constraint goods_receipts_employee_organization_fkey foreign key (received_by_employee_id, organization_id) references public.employees (id, organization_id) on delete restrict,
  constraint goods_receipts_note_length check (note is null or char_length(note) <= 500)
);
create index goods_receipts_order_received_idx on public.goods_receipts (purchase_order_id, received_at desc);
create table public.goods_receipt_lines (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, goods_receipt_id uuid not null, purchase_order_line_id uuid not null, quantity_received numeric(14,3) not null,
  constraint goods_receipt_lines_receipt_organization_fkey foreign key (goods_receipt_id, organization_id) references public.goods_receipts (id, organization_id) on delete restrict,
  constraint goods_receipt_lines_order_line_fkey foreign key (purchase_order_line_id) references public.purchase_order_lines (id) on delete restrict,
  constraint goods_receipt_lines_quantity_positive check (quantity_received > 0), constraint goods_receipt_lines_unique unique (goods_receipt_id, purchase_order_line_id)
);

create table public.inventory_counts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations (id) on delete restrict, store_id uuid not null,
  status text not null default 'open', note text, started_by_employee_id uuid not null, completed_by_employee_id uuid, started_at timestamptz not null default now(), completed_at timestamptz,
  constraint inventory_counts_id_organization_unique unique (id, organization_id),
  constraint inventory_counts_store_organization_fkey foreign key (store_id, organization_id) references public.stores (id, organization_id) on delete restrict,
  constraint inventory_counts_starter_organization_fkey foreign key (started_by_employee_id, organization_id) references public.employees (id, organization_id) on delete restrict,
  constraint inventory_counts_completer_organization_fkey foreign key (completed_by_employee_id, organization_id) references public.employees (id, organization_id) on delete restrict,
  constraint inventory_counts_status_values check (status in ('open','completed','cancelled')),
  constraint inventory_counts_completion_state check ((status = 'completed' and completed_by_employee_id is not null and completed_at is not null) or status <> 'completed')
);
create index inventory_counts_organization_store_status_idx on public.inventory_counts (organization_id, store_id, status, started_at desc);
create table public.inventory_count_lines (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, inventory_count_id uuid not null, product_id uuid not null, variant_id uuid,
  expected_quantity numeric(14,3) not null, counted_quantity numeric(14,3) not null,
  constraint inventory_count_lines_count_organization_fkey foreign key (inventory_count_id, organization_id) references public.inventory_counts (id, organization_id) on delete restrict,
  constraint inventory_count_lines_product_organization_fkey foreign key (product_id, organization_id) references public.products (id, organization_id) on delete restrict,
  constraint inventory_count_lines_variant_product_organization_fkey foreign key (variant_id, product_id, organization_id) references public.product_variants (id, product_id, organization_id) on delete restrict,
  constraint inventory_count_lines_saleable_unique unique (inventory_count_id, product_id, variant_id),
  constraint inventory_count_lines_quantities_nonnegative check (expected_quantity >= 0 and counted_quantity >= 0)
);

create table public.stock_transfers (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations (id) on delete restrict, source_store_id uuid not null, destination_store_id uuid not null,
  status text not null default 'completed', note text, transferred_by_employee_id uuid not null, completed_at timestamptz not null default now(),
  constraint stock_transfers_id_organization_unique unique (id, organization_id),
  constraint stock_transfers_source_organization_fkey foreign key (source_store_id, organization_id) references public.stores (id, organization_id) on delete restrict,
  constraint stock_transfers_destination_organization_fkey foreign key (destination_store_id, organization_id) references public.stores (id, organization_id) on delete restrict,
  constraint stock_transfers_employee_organization_fkey foreign key (transferred_by_employee_id, organization_id) references public.employees (id, organization_id) on delete restrict,
  constraint stock_transfers_different_stores check (source_store_id <> destination_store_id), constraint stock_transfers_status_values check (status = 'completed'), constraint stock_transfers_note_length check (note is null or char_length(note) <= 500)
);
create index stock_transfers_organization_source_completed_idx on public.stock_transfers (organization_id, source_store_id, completed_at desc);
create table public.stock_transfer_lines (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, stock_transfer_id uuid not null, product_id uuid not null, variant_id uuid, quantity numeric(14,3) not null,
  constraint stock_transfer_lines_transfer_organization_fkey foreign key (stock_transfer_id, organization_id) references public.stock_transfers (id, organization_id) on delete restrict,
  constraint stock_transfer_lines_product_organization_fkey foreign key (product_id, organization_id) references public.products (id, organization_id) on delete restrict,
  constraint stock_transfer_lines_variant_product_organization_fkey foreign key (variant_id, product_id, organization_id) references public.product_variants (id, product_id, organization_id) on delete restrict,
  constraint stock_transfer_lines_saleable_unique unique (stock_transfer_id, product_id, variant_id), constraint stock_transfer_lines_quantity_positive check (quantity > 0)
);

alter table public.inventory_movements drop constraint inventory_movements_type_values;
alter table public.inventory_movements add constraint inventory_movements_type_values check (movement_type in ('OPENING_STOCK','ADJUSTMENT','SALE','REFUND','RECEIPT','COUNT','TRANSFER_OUT','TRANSFER_IN'));

alter table public.suppliers enable row level security; alter table public.purchase_orders enable row level security; alter table public.purchase_order_lines enable row level security; alter table public.goods_receipts enable row level security; alter table public.goods_receipt_lines enable row level security; alter table public.inventory_counts enable row level security; alter table public.inventory_count_lines enable row level security; alter table public.stock_transfers enable row level security; alter table public.stock_transfer_lines enable row level security;
revoke all on table public.suppliers, public.purchase_orders, public.purchase_order_lines, public.goods_receipts, public.goods_receipt_lines, public.inventory_counts, public.inventory_count_lines, public.stock_transfers, public.stock_transfer_lines from public, anon, authenticated, service_role;
grant select on table public.suppliers, public.purchase_orders, public.purchase_order_lines, public.goods_receipts, public.goods_receipt_lines, public.inventory_counts, public.inventory_count_lines, public.stock_transfers, public.stock_transfer_lines to authenticated;
create policy suppliers_select_inventory_manager on public.suppliers for select to authenticated using ((select private.has_permission(organization_id, 'inventory.manage')));
create policy purchase_orders_select_inventory_manager on public.purchase_orders for select to authenticated using ((select private.has_permission(organization_id, 'inventory.manage')));
create policy purchase_order_lines_select_inventory_manager on public.purchase_order_lines for select to authenticated using ((select private.has_permission(organization_id, 'inventory.manage')));
create policy goods_receipts_select_inventory_manager on public.goods_receipts for select to authenticated using ((select private.has_permission(organization_id, 'inventory.manage')));
create policy goods_receipt_lines_select_inventory_manager on public.goods_receipt_lines for select to authenticated using ((select private.has_permission(organization_id, 'inventory.manage')));
create policy inventory_counts_select_inventory_manager on public.inventory_counts for select to authenticated using ((select private.has_permission(organization_id, 'inventory.manage')));
create policy inventory_count_lines_select_inventory_manager on public.inventory_count_lines for select to authenticated using ((select private.has_permission(organization_id, 'inventory.manage')));
create policy stock_transfers_select_inventory_manager on public.stock_transfers for select to authenticated using ((select private.has_permission(organization_id, 'inventory.manage')));
create policy stock_transfer_lines_select_inventory_manager on public.stock_transfer_lines for select to authenticated using ((select private.has_permission(organization_id, 'inventory.manage')));

create trigger suppliers_set_updated_at before update on public.suppliers for each row execute function private.set_updated_at();
create trigger purchase_orders_set_updated_at before update on public.purchase_orders for each row execute function private.set_updated_at();

create or replace function private.inventory_actor(target_organization_id uuid, target_store_id uuid) returns uuid language sql security definer set search_path = '' as $$
  select employee.id from public.employees employee join public.employee_stores assignment on assignment.employee_id = employee.id and assignment.organization_id = employee.organization_id and assignment.store_id = target_store_id where employee.organization_id = target_organization_id and employee.profile_id = (select auth.uid()) and employee.status = 'active';
$$;

create or replace function private.apply_inventory_change(target_organization_id uuid, target_store_id uuid, target_product_id uuid, target_variant_id uuid, target_quantity_delta numeric, target_movement_type text, target_actor_employee_id uuid, target_reason text, target_source_type text, target_source_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare current_quantity numeric(14,3); next_quantity numeric(14,3);
begin
  if target_quantity_delta = 0 then raise exception 'Inventory quantity change cannot be zero.' using errcode = '23514'; end if;
  select quantity into current_quantity from public.inventory_levels where organization_id = target_organization_id and store_id = target_store_id and product_id = target_product_id and variant_id is not distinct from target_variant_id for update;
  if not found then raise exception 'The stock projection is not initialized for this item and store.' using errcode = '23514'; end if;
  next_quantity := current_quantity + target_quantity_delta;
  update public.inventory_levels set quantity = next_quantity, updated_at = now() where organization_id = target_organization_id and store_id = target_store_id and product_id = target_product_id and variant_id is not distinct from target_variant_id;
  insert into public.inventory_movements (organization_id, store_id, product_id, variant_id, quantity_delta, quantity_before, quantity_after, movement_type, actor_employee_id, reason, source_type, source_id) values (target_organization_id,target_store_id,target_product_id,target_variant_id,target_quantity_delta,current_quantity,next_quantity,target_movement_type,target_actor_employee_id,target_reason,target_source_type,target_source_id);
end; $$;

create or replace function private.validate_purchase_order_line() returns trigger language plpgsql security definer set search_path = '' as $$
declare target_store_id uuid;
begin
  select store_id into target_store_id from public.purchase_orders where id = new.purchase_order_id and organization_id = new.organization_id;
  if target_store_id is null or exists (select 1 from public.purchase_order_lines line where line.purchase_order_id = new.purchase_order_id and line.product_id = new.product_id and line.variant_id is not distinct from new.variant_id) then raise exception 'Purchase order items must be unique and belong to the receiving store.' using errcode = '23514'; end if;
  if not exists (select 1 from public.inventory_levels level where level.organization_id = new.organization_id and level.store_id = target_store_id and level.product_id = new.product_id and level.variant_id is not distinct from new.variant_id) then raise exception 'Every purchase order item needs an inventory projection in the receiving store.' using errcode = '23514'; end if;
  return new;
end; $$;

create or replace function private.validate_inventory_count_line() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.inventory_count_lines line where line.inventory_count_id = new.inventory_count_id and line.product_id = new.product_id and line.variant_id is not distinct from new.variant_id) then raise exception 'Each item can be counted once.' using errcode = '23514'; end if;
  return new;
end; $$;

create or replace function private.validate_stock_transfer_line() returns trigger language plpgsql security definer set search_path = '' as $$
declare source_store uuid; destination_store uuid;
begin
  select source_store_id, destination_store_id into source_store, destination_store from public.stock_transfers where id = new.stock_transfer_id and organization_id = new.organization_id;
  if source_store is null or exists (select 1 from public.stock_transfer_lines line where line.stock_transfer_id = new.stock_transfer_id and line.product_id = new.product_id and line.variant_id is not distinct from new.variant_id) then raise exception 'Transfer items must be unique.' using errcode = '23514'; end if;
  if not exists (select 1 from public.inventory_levels level where level.organization_id = new.organization_id and level.store_id in (source_store, destination_store) and level.product_id = new.product_id and level.variant_id is not distinct from new.variant_id group by level.product_id, level.variant_id having count(*) = 2) then raise exception 'The item must have stock projections in both stores before it can be transferred.' using errcode = '23514'; end if;
  return new;
end; $$;

create trigger purchase_order_lines_validate_inventory before insert on public.purchase_order_lines for each row execute function private.validate_purchase_order_line();
create trigger inventory_count_lines_validate_unique before insert on public.inventory_count_lines for each row execute function private.validate_inventory_count_line();
create trigger stock_transfer_lines_validate_inventory before insert on public.stock_transfer_lines for each row execute function private.validate_stock_transfer_line();

create or replace function private.create_supplier(target_organization_id uuid, target_name text, target_contact_name text, target_email text, target_phone text, target_address text, target_notes text) returns uuid language plpgsql security definer set search_path = '' as $$ declare supplier_id uuid; begin
 if (select auth.uid()) is null or not (select private.has_permission(target_organization_id,'inventory.manage')) then raise exception 'Inventory permission is required.' using errcode='42501'; end if;
 insert into public.suppliers (organization_id,name,contact_name,email,phone,address,notes) values (target_organization_id,nullif(btrim(target_name),''),nullif(btrim(target_contact_name),''),nullif(btrim(target_email),''),nullif(btrim(target_phone),''),nullif(btrim(target_address),''),nullif(btrim(target_notes),'')) returning id into supplier_id; return supplier_id; end; $$;
create or replace function public.create_supplier(target_organization_id uuid, target_name text, target_contact_name text, target_email text, target_phone text, target_address text, target_notes text) returns uuid language sql security invoker set search_path='' as $$ select private.create_supplier(target_organization_id,target_name,target_contact_name,target_email,target_phone,target_address,target_notes); $$;

create or replace function private.create_purchase_order(target_organization_id uuid, target_store_id uuid, target_supplier_id uuid, target_notes text, target_expected_at date, target_lines jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare actor_id uuid; order_id uuid; line jsonb; product_row record; next_number bigint;
begin
 if (select auth.uid()) is null or not (select private.has_permission(target_organization_id,'inventory.manage')) then raise exception 'Inventory permission is required.' using errcode='42501'; end if;
 if target_lines is null or jsonb_typeof(target_lines) <> 'array' or jsonb_array_length(target_lines) not between 1 and 100 then raise exception 'A purchase order needs one to 100 items.' using errcode='23514'; end if;
 actor_id := private.inventory_actor(target_organization_id,target_store_id); if actor_id is null then raise exception 'An assigned employee is required for this store.' using errcode='42501'; end if;
 if not exists (select 1 from public.suppliers where id=target_supplier_id and organization_id=target_organization_id and is_active) then raise exception 'Choose an active supplier.' using errcode='23514'; end if;
 next_number := nextval('private.tindio_purchase_order_number_sequence'::regclass);
 insert into public.purchase_orders (organization_id,store_id,supplier_id,order_number,status,notes,expected_at,ordered_at,created_by_employee_id) values (target_organization_id,target_store_id,target_supplier_id,next_number,'ordered',nullif(btrim(target_notes),''),target_expected_at,now(),actor_id) returning id into order_id;
 for line in select value from jsonb_array_elements(target_lines) loop
   if coalesce(line->>'quantity','') !~ '^\d+(\.\d{1,3})?$' or (line->>'quantity')::numeric <= 0 or coalesce(line->>'unit_cost_minor','') !~ '^\d+$' then raise exception 'Purchase order quantities and costs must be valid.' using errcode='23514'; end if;
   select product.name as product_name, variant.name as variant_name, product.unit into product_row from public.products product left join public.product_variants variant on variant.id=nullif(line->>'variant_id','')::uuid and variant.product_id=product.id and variant.organization_id=product.organization_id where product.id=(line->>'product_id')::uuid and product.organization_id=target_organization_id and product.status='active' and product.track_inventory and (nullif(line->>'variant_id','') is null or variant.id is not null);
   if not found then raise exception 'Every order item must be an active tracked product.' using errcode='23514'; end if;
   insert into public.purchase_order_lines (organization_id,purchase_order_id,product_id,variant_id,product_name_snapshot,variant_name_snapshot,unit_snapshot,ordered_quantity,unit_cost_minor) values (target_organization_id,order_id,(line->>'product_id')::uuid,nullif(line->>'variant_id','')::uuid,product_row.product_name,product_row.variant_name,product_row.unit,(line->>'quantity')::numeric,(line->>'unit_cost_minor')::bigint);
 end loop; return order_id; end; $$;
create or replace function public.create_purchase_order(target_organization_id uuid, target_store_id uuid, target_supplier_id uuid, target_notes text, target_expected_at date, target_lines jsonb) returns uuid language sql security invoker set search_path='' as $$ select private.create_purchase_order(target_organization_id,target_store_id,target_supplier_id,target_notes,target_expected_at,target_lines); $$;

create or replace function private.receive_purchase_order(target_organization_id uuid, target_purchase_order_id uuid, target_lines jsonb, target_note text) returns uuid language plpgsql security definer set search_path='' as $$
declare purchase public.purchase_orders%rowtype; actor_id uuid; receipt_id uuid; line jsonb; po_line public.purchase_order_lines%rowtype; quantity_received numeric(14,3); total_remaining numeric(14,3);
begin
 if (select auth.uid()) is null or not (select private.has_permission(target_organization_id,'inventory.manage')) then raise exception 'Inventory permission is required.' using errcode='42501'; end if;
 if target_lines is null or jsonb_typeof(target_lines) <> 'array' or jsonb_array_length(target_lines) not between 1 and 100 then raise exception 'A receipt needs one to 100 items.' using errcode='23514'; end if;
 select * into purchase from public.purchase_orders where id=target_purchase_order_id and organization_id=target_organization_id and status in ('ordered','partially_received') for update; if purchase.id is null then raise exception 'This purchase order cannot be received.' using errcode='23514'; end if;
 actor_id := private.inventory_actor(target_organization_id,purchase.store_id); if actor_id is null then raise exception 'An assigned employee is required for this store.' using errcode='42501'; end if;
 insert into public.goods_receipts (organization_id,purchase_order_id,store_id,received_by_employee_id,note) values (target_organization_id,purchase.id,purchase.store_id,actor_id,nullif(btrim(target_note),'')) returning id into receipt_id;
 for line in select value from jsonb_array_elements(target_lines) loop
  if coalesce(line->>'quantity','') !~ '^\d+(\.\d{1,3})?$' or (line->>'quantity')::numeric <= 0 then raise exception 'Receipt quantities must be positive.' using errcode='23514'; end if;
  select * into po_line from public.purchase_order_lines where id=(line->>'purchase_order_line_id')::uuid and purchase_order_id=purchase.id and organization_id=target_organization_id for update; if po_line.id is null then raise exception 'A receipt line does not belong to this purchase order.' using errcode='23514'; end if;
  quantity_received := (line->>'quantity')::numeric; if po_line.received_quantity + quantity_received > po_line.ordered_quantity then raise exception 'Received quantity cannot exceed the ordered quantity.' using errcode='23514'; end if;
  insert into public.goods_receipt_lines (organization_id,goods_receipt_id,purchase_order_line_id,quantity_received) values (target_organization_id,receipt_id,po_line.id,quantity_received);
  update public.purchase_order_lines set received_quantity=received_quantity+quantity_received where id=po_line.id;
  perform private.apply_inventory_change(target_organization_id,purchase.store_id,po_line.product_id,po_line.variant_id,quantity_received,'RECEIPT',actor_id,'Purchase order receipt','goods_receipt',receipt_id);
 end loop;
 select coalesce(sum(ordered_quantity-received_quantity),0) into total_remaining from public.purchase_order_lines where purchase_order_id=purchase.id;
 update public.purchase_orders set status=case when total_remaining=0 then 'received' else 'partially_received' end, received_at=now(), received_by_employee_id=actor_id where id=purchase.id;
 return receipt_id; end; $$;
create or replace function public.receive_purchase_order(target_organization_id uuid, target_purchase_order_id uuid, target_lines jsonb, target_note text) returns uuid language sql security invoker set search_path='' as $$ select private.receive_purchase_order(target_organization_id,target_purchase_order_id,target_lines,target_note); $$;

create or replace function private.complete_inventory_count(target_organization_id uuid, target_store_id uuid, target_note text, target_lines jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare actor_id uuid; count_id uuid; line jsonb; expected numeric(14,3); counted numeric(14,3); target_line_product_id uuid; target_line_variant_id uuid;
begin
 if (select auth.uid()) is null or not (select private.has_permission(target_organization_id,'inventory.manage')) then raise exception 'Inventory permission is required.' using errcode='42501'; end if;
 if target_lines is null or jsonb_typeof(target_lines) <> 'array' or jsonb_array_length(target_lines) not between 1 and 500 then raise exception 'A count needs one to 500 items.' using errcode='23514'; end if;
 actor_id:=private.inventory_actor(target_organization_id,target_store_id); if actor_id is null then raise exception 'An assigned employee is required for this store.' using errcode='42501'; end if;
 insert into public.inventory_counts (organization_id,store_id,status,note,started_by_employee_id,completed_by_employee_id,completed_at) values (target_organization_id,target_store_id,'completed',nullif(btrim(target_note),''),actor_id,actor_id,now()) returning id into count_id;
 for line in select value from jsonb_array_elements(target_lines) loop
  if coalesce(line->>'counted_quantity','') !~ '^\d+(\.\d{1,3})?$' then raise exception 'Counted quantities must be non-negative.' using errcode='23514'; end if;
  target_line_product_id:=(line->>'product_id')::uuid; target_line_variant_id:=nullif(line->>'variant_id','')::uuid; counted:=(line->>'counted_quantity')::numeric;
  select level.quantity into expected from public.inventory_levels level where level.organization_id=target_organization_id and level.store_id=target_store_id and level.product_id=target_line_product_id and level.variant_id is not distinct from target_line_variant_id for update; if not found then raise exception 'One count item has no stock projection.' using errcode='23514'; end if;
  insert into public.inventory_count_lines (organization_id,inventory_count_id,product_id,variant_id,expected_quantity,counted_quantity) values (target_organization_id,count_id,target_line_product_id,target_line_variant_id,expected,counted);
  if counted <> expected then perform private.apply_inventory_change(target_organization_id,target_store_id,target_line_product_id,target_line_variant_id,counted-expected,'COUNT',actor_id,'Inventory count','inventory_count',count_id); end if;
 end loop; return count_id; end; $$;
create or replace function public.complete_inventory_count(target_organization_id uuid, target_store_id uuid, target_note text, target_lines jsonb) returns uuid language sql security invoker set search_path='' as $$ select private.complete_inventory_count(target_organization_id,target_store_id,target_note,target_lines); $$;

create or replace function private.transfer_stock(target_organization_id uuid, target_source_store_id uuid, target_destination_store_id uuid, target_lines jsonb, target_note text) returns uuid language plpgsql security definer set search_path='' as $$ declare actor_id uuid; transfer_id uuid; line jsonb; source_quantity numeric(14,3); begin
 if (select auth.uid()) is null or not (select private.has_permission(target_organization_id,'inventory.manage')) then raise exception 'Inventory permission is required.' using errcode='42501'; end if;
 if target_source_store_id = target_destination_store_id or target_lines is null or jsonb_typeof(target_lines) <> 'array' or jsonb_array_length(target_lines) not between 1 and 100 then raise exception 'Choose two stores and one to 100 transfer items.' using errcode='23514'; end if;
 actor_id := private.inventory_actor(target_organization_id,target_source_store_id); if actor_id is null then raise exception 'An assigned employee is required for the source store.' using errcode='42501'; end if;
 insert into public.stock_transfers (organization_id,source_store_id,destination_store_id,transferred_by_employee_id,note) values (target_organization_id,target_source_store_id,target_destination_store_id,actor_id,nullif(btrim(target_note),'')) returning id into transfer_id;
 for line in select value from jsonb_array_elements(target_lines) loop
  if coalesce(line->>'quantity','') !~ '^\d+(\.\d{1,3})?$' or (line->>'quantity')::numeric <= 0 then raise exception 'Transfer quantities must be positive.' using errcode='23514'; end if;
  select quantity into source_quantity from public.inventory_levels where organization_id=target_organization_id and store_id=target_source_store_id and product_id=(line->>'product_id')::uuid and variant_id is not distinct from nullif(line->>'variant_id','')::uuid for update;
  if source_quantity is null or source_quantity < (line->>'quantity')::numeric then raise exception 'Source stock is insufficient for this transfer.' using errcode='23514'; end if;
  insert into public.stock_transfer_lines (organization_id,stock_transfer_id,product_id,variant_id,quantity) values (target_organization_id,transfer_id,(line->>'product_id')::uuid,nullif(line->>'variant_id','')::uuid,(line->>'quantity')::numeric);
  perform private.apply_inventory_change(target_organization_id,target_source_store_id,(line->>'product_id')::uuid,nullif(line->>'variant_id','')::uuid,-(line->>'quantity')::numeric,'TRANSFER_OUT',actor_id,'Stock transfer out','stock_transfer',transfer_id);
  perform private.apply_inventory_change(target_organization_id,target_destination_store_id,(line->>'product_id')::uuid,nullif(line->>'variant_id','')::uuid,(line->>'quantity')::numeric,'TRANSFER_IN',actor_id,'Stock transfer in','stock_transfer',transfer_id);
 end loop; return transfer_id; end; $$;
create or replace function public.transfer_stock(target_organization_id uuid, target_source_store_id uuid, target_destination_store_id uuid, target_lines jsonb, target_note text) returns uuid language sql security invoker set search_path='' as $$ select private.transfer_stock(target_organization_id,target_source_store_id,target_destination_store_id,target_lines,target_note); $$;

revoke execute on function private.inventory_actor(uuid,uuid), private.apply_inventory_change(uuid,uuid,uuid,uuid,numeric,text,uuid,text,text,uuid), private.validate_purchase_order_line(), private.validate_inventory_count_line(), private.validate_stock_transfer_line(), private.create_supplier(uuid,text,text,text,text,text,text), private.create_purchase_order(uuid,uuid,uuid,text,date,jsonb), private.receive_purchase_order(uuid,uuid,jsonb,text), private.complete_inventory_count(uuid,uuid,text,jsonb), private.transfer_stock(uuid,uuid,uuid,jsonb,text) from public,anon,service_role;
grant execute on function private.create_supplier(uuid,text,text,text,text,text,text), private.create_purchase_order(uuid,uuid,uuid,text,date,jsonb), private.receive_purchase_order(uuid,uuid,jsonb,text), private.complete_inventory_count(uuid,uuid,text,jsonb), private.transfer_stock(uuid,uuid,uuid,jsonb,text) to authenticated;
revoke execute on function public.create_supplier(uuid,text,text,text,text,text,text), public.create_purchase_order(uuid,uuid,uuid,text,date,jsonb), public.receive_purchase_order(uuid,uuid,jsonb,text), public.complete_inventory_count(uuid,uuid,text,jsonb), public.transfer_stock(uuid,uuid,uuid,jsonb,text) from public,anon,service_role;
grant execute on function public.create_supplier(uuid,text,text,text,text,text,text), public.create_purchase_order(uuid,uuid,uuid,text,date,jsonb), public.receive_purchase_order(uuid,uuid,jsonb,text), public.complete_inventory_count(uuid,uuid,text,jsonb), public.transfer_stock(uuid,uuid,uuid,jsonb,text) to authenticated;
commit;
