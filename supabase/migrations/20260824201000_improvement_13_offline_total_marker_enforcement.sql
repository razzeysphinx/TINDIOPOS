-- The legacy total guard ran while sales were updated, before the advanced
-- checkout routine inserted its final payment note. Enforce at payment insert
-- time instead so an offline total mismatch aborts the entire transaction.

begin;

create or replace function private.guard_offline_payment_total_marker()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_total_minor bigint;
  recorded_total_minor bigint;
begin
  if new.note !~ '\[tindio-offline-total:[0-9]+\]' then
    return new;
  end if;

  expected_total_minor := (regexp_match(new.note, '\[tindio-offline-total:([0-9]+)\]'))[1]::bigint;
  select sale.total_minor
  into recorded_total_minor
  from public.sales sale
  where sale.id = new.sale_id
    and sale.organization_id = new.organization_id;

  if recorded_total_minor is null or recorded_total_minor <> expected_total_minor then
    raise exception 'This queued sale total changed while offline. Review the sale before recording it.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_offline_payment_total_marker on public.payments;
create trigger guard_offline_payment_total_marker
before insert or update of note on public.payments
for each row
execute function private.guard_offline_payment_total_marker();

revoke execute on function private.guard_offline_payment_total_marker()
from public, anon, authenticated, service_role;

comment on function private.guard_offline_payment_total_marker()
is 'Phase 13: rejects an offline-marked payment when the server-calculated checkout total no longer matches its locally captured amount.';

commit;
