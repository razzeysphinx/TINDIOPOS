begin;

-- calculate_shift_cash returns a table-shaped record. Materialize each value
-- into a typed local variable before returning it; PL/pgSQL otherwise cannot
-- safely dereference a generic record in RETURN QUERY.
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
  calculated_cash_sales_minor bigint;
  calculated_cash_refunds_minor bigint;
  calculated_pay_ins_minor bigint;
  calculated_pay_outs_minor bigint;
  calculated_expected_cash_minor bigint;
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

  if target_shift.status = 'open' and not coalesce(show_expected_cash, true) then
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

  select
    calculated.cash_sales_minor,
    calculated.cash_refunds_minor,
    calculated.pay_ins_minor,
    calculated.pay_outs_minor,
    calculated.expected_cash_minor
  into
    calculated_cash_sales_minor,
    calculated_cash_refunds_minor,
    calculated_pay_ins_minor,
    calculated_pay_outs_minor,
    calculated_expected_cash_minor
  from private.calculate_shift_cash(target_shift.id) calculated;

  return query
  select
    target_shift.id,
    target_shift.status,
    target_shift.opening_cash_minor,
    calculated_cash_sales_minor,
    calculated_cash_refunds_minor,
    calculated_pay_ins_minor,
    calculated_pay_outs_minor,
    calculated_expected_cash_minor;
end;
$$;

comment on function private.get_shift_cash_summary(uuid, uuid)
is 'Returns server-derived cash figures to authorized users; when blind closing is enabled, figures remain hidden until the shift closes.';

notify pgrst, 'reload schema';

commit;
