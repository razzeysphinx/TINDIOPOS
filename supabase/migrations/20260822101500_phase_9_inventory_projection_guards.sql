-- Phase 9 hardening: reject duplicate document lines and inventory operations without projections.
begin;

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

drop trigger if exists purchase_order_lines_validate_inventory on public.purchase_order_lines;
drop trigger if exists inventory_count_lines_validate_unique on public.inventory_count_lines;
drop trigger if exists stock_transfer_lines_validate_inventory on public.stock_transfer_lines;
create trigger purchase_order_lines_validate_inventory before insert on public.purchase_order_lines for each row execute function private.validate_purchase_order_line();
create trigger inventory_count_lines_validate_unique before insert on public.inventory_count_lines for each row execute function private.validate_inventory_count_line();
create trigger stock_transfer_lines_validate_inventory before insert on public.stock_transfer_lines for each row execute function private.validate_stock_transfer_line();

revoke execute on function private.validate_purchase_order_line(), private.validate_inventory_count_line(), private.validate_stock_transfer_line() from public, anon, authenticated, service_role;

commit;
