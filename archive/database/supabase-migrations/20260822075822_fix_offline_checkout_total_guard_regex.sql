begin;

create or replace function private.guard_offline_checkout_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_total_minor bigint;
begin
  select (regexp_match(payment.note, '\[tindio-offline-total:([0-9]+)\]'))[1]::bigint
    into expected_total_minor
  from public.payments payment
  where payment.organization_id = new.organization_id
    and payment.sale_id = new.id
    and payment.note ~ '\[tindio-offline-total:[0-9]+\]'
  order by payment.created_at, payment.id
  limit 1;

  if expected_total_minor is not null
    and new.total_minor <> expected_total_minor then
    raise exception 'This queued sale total changed while offline. Review the sale before recording it.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function private.remove_offline_checkout_total_marker()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.payments payment
  set note = nullif(
    btrim(regexp_replace(payment.note, '\s*\[tindio-offline-total:[0-9]+\]', '', 'g')),
    ''
  )
  where payment.organization_id = new.organization_id
    and payment.sale_id = new.id
    and payment.note ~ '\[tindio-offline-total:[0-9]+\]';

  return new;
end;
$$;

revoke all on function private.guard_offline_checkout_total() from public, anon, authenticated, service_role;
revoke all on function private.remove_offline_checkout_total_marker() from public, anon, authenticated, service_role;

commit;
