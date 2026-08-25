-- Install the finalized supplier-lead-time behavior for an existing local
-- database where the first Phase 14 migration was already recorded.
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
revoke execute on function private.default_purchase_order_expected_at_from_supplier() from public, anon, authenticated, service_role;
