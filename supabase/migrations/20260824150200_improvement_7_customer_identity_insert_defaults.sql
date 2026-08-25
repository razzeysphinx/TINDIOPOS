-- Existing deployments applied the identity columns before their insert
-- defaults were introduced. The trigger replaces these sentinel defaults with
-- the real organization-scoped values before constraints are checked.

begin;

alter table public.customers
  alter column customer_number set default 0,
  alter column loyalty_card_code set default '';

create or replace function private.assign_customer_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.customer_number <> 0 then
      raise exception 'Customer numbers are assigned by TINDIO.' using errcode = '42501';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(new.organization_id::text, 702017)
    );

    select coalesce(max(customer.customer_number), 0) + 1
    into new.customer_number
    from public.customers customer
    where customer.organization_id = new.organization_id;
  end if;

  new.loyalty_card_code := nullif(btrim(coalesce(new.loyalty_card_code, '')), '');
  if new.loyalty_card_code is null then
    new.loyalty_card_code := 'TND-' || lpad(new.customer_number::text, 8, '0');
  end if;

  return new;
end;
$$;

revoke execute on function private.assign_customer_identity()
from public, anon, authenticated, service_role;

commit;
