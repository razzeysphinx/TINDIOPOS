-- Phase 1: inventory ledger integrity.
--
-- `inventory_levels` remains the current stock projection.  This migration
-- strengthens its authoritative append-only ledger without changing any stock
-- quantity, product, source document, or permission rule.

alter table public.inventory_movements
  add column if not exists unit_snapshot text,
  add column if not exists operation_id uuid;

-- Existing products have an immutable base unit.  Capture that unit on the
-- historical ledger rows before making the snapshot required for new and old
-- records alike.  An inventory movement is never re-valued or re-quantified.
update public.inventory_movements movement
set unit_snapshot = product.unit
from public.products product
where product.id = movement.product_id
  and product.organization_id = movement.organization_id
  and movement.unit_snapshot is null;

-- A source document is the operation identity for document-backed movements.
-- Historical opening/manual movements intentionally have no document source,
-- so their immutable movement id remains their operation identity.
update public.inventory_movements movement
set operation_id = coalesce(movement.source_id, movement.id)
where movement.operation_id is null;

alter table public.inventory_movements
  alter column actor_employee_id set not null,
  alter column unit_snapshot set not null,
  alter column operation_id set not null;

alter table public.inventory_movements
  add constraint inventory_movements_unit_snapshot_length
  check (char_length(btrim(unit_snapshot)) between 1 and 80);

create or replace function private.enforce_inventory_movement_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  catalog_unit text;
begin
  -- Stock movements may only be posted for inventory-tracked saleables.  This
  -- protects the ledger even when a caller bypasses a UI-level filter.
  select product.unit
    into catalog_unit
  from public.products product
  where product.id = new.product_id
    and product.organization_id = new.organization_id
    and product.track_inventory;

  if catalog_unit is null then
    raise exception 'Inventory movements require an inventory-tracked product.'
      using errcode = '23514';
  end if;

  if new.actor_employee_id is null then
    raise exception 'Inventory movements require an employee actor.'
      using errcode = '23514';
  end if;

  -- The database captures the product's canonical base unit at posting time.
  -- Callers cannot accidentally omit it, and later product presentation
  -- changes cannot rewrite historical movement meaning.
  new.unit_snapshot := coalesce(nullif(btrim(new.unit_snapshot), ''), catalog_unit);
  new.operation_id := coalesce(new.operation_id, new.source_id, new.id);

  if new.operation_id is null then
    raise exception 'Inventory movements require an immutable operation identity.'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

revoke execute on function private.enforce_inventory_movement_insert() from public;

drop trigger if exists inventory_movements_enforce_insert on public.inventory_movements;
create trigger inventory_movements_enforce_insert
before insert on public.inventory_movements
for each row execute function private.enforce_inventory_movement_insert();

create or replace function private.prevent_inventory_movement_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception 'Inventory movements are append-only. Record a correcting movement instead.'
    using errcode = '55000';
end;
$function$;

revoke execute on function private.prevent_inventory_movement_mutation() from public;

drop trigger if exists inventory_movements_append_only on public.inventory_movements;
create trigger inventory_movements_append_only
before update or delete on public.inventory_movements
for each row execute function private.prevent_inventory_movement_mutation();

create index if not exists inventory_movements_source_lookup_idx
  on public.inventory_movements (organization_id, source_type, source_id, created_at desc)
  where source_id is not null;

create index if not exists inventory_movements_operation_lookup_idx
  on public.inventory_movements (organization_id, operation_id, created_at desc);

comment on column public.inventory_movements.unit_snapshot is
  'Canonical inventory base unit captured when the movement was posted.';

comment on column public.inventory_movements.operation_id is
  'Immutable operation identity. Source-document UUID when one exists, otherwise the movement UUID.';
