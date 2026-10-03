-- Correct the blind-cash capability wrapper: opening cash is persisted on the
-- shift itself, not returned by calculate_shift_cash().
begin;

create or replace function private.get_shift_cash_summary(
  target_organization_id uuid,
  target_shift_id uuid
)
returns table (
  shift_id uuid,
  status text,
  opening_cash_minor bigint,
  cash_sales_minor bigint,
  cash_refunds_minor bigint,
  pay_ins_minor bigint,
  pay_outs_minor bigint,
  expected_cash_minor bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_shift public.shifts%rowtype;
  calculated_cash record;
  show_expected_cash boolean := true;
begin
  select shift.*
  into target_shift
  from public.shifts shift
  where shift.id = target_shift_id
    and shift.organization_id = target_organization_id;

  if target_shift.id is null then
    raise exception 'The shift was not found.' using errcode = 'P0002';
  end if;

  if not (select private.has_shift_access(target_organization_id, target_shift.store_id)) then
    raise exception 'Shift access is required.' using errcode = '42501';
  end if;

  select organization.show_expected_cash_before_close
  into show_expected_cash
  from public.organizations organization
  where organization.id = target_organization_id;

  if target_shift.status = 'open'
    and not coalesce(show_expected_cash, true)
    and not (select private.has_permission(target_organization_id, 'shifts.view_expected_cash')) then
    return query
    select
      target_shift.id,
      target_shift.status,
      null::bigint,
      null::bigint,
      null::bigint,
      null::bigint,
      null::bigint,
      null::bigint;
    return;
  end if;

  select *
  into calculated_cash
  from private.calculate_shift_cash(target_shift.id);

  return query
  select
    target_shift.id,
    target_shift.status,
    target_shift.opening_cash_minor,
    calculated_cash.cash_sales_minor,
    calculated_cash.cash_refunds_minor,
    calculated_cash.pay_ins_minor,
    calculated_cash.pay_outs_minor,
    calculated_cash.expected_cash_minor;
end;
$$;

comment on function private.get_shift_cash_summary(uuid, uuid)
is 'Returns server-derived cash figures to authorized users; a blind open shift stays hidden until close unless the caller has shifts.view_expected_cash.';

commit;
