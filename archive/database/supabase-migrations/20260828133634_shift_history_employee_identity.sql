-- Add the cashier identity to the existing permission-scoped closed-shift list.
begin;

drop function if exists public.get_shift_audit_history(uuid, integer);
create function public.get_shift_audit_history(
  target_organization_id uuid,
  target_limit integer default 25
)
returns table (
  shift_id uuid,
  store_id uuid,
  register_id uuid,
  opened_by_employee_id uuid,
  opened_by_name text,
  opening_cash_minor bigint,
  expected_cash_minor bigint,
  counted_cash_minor bigint,
  difference_minor bigint,
  opening_note text,
  closing_note text,
  opened_at timestamptz,
  closed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  viewer_employee_id uuid;
  can_manage_settings boolean := false;
  can_view_history boolean := false;
begin
  if target_organization_id is null or target_limit is null or target_limit < 1 or target_limit > 100 then
    raise exception 'The shift audit history request is invalid.' using errcode = '23514';
  end if;

  if (select auth.uid()) is null then
    raise exception 'Sign in is required to view shift history.' using errcode = '42501';
  end if;

  select private.current_employee_id(target_organization_id) into viewer_employee_id;
  if viewer_employee_id is null then
    raise exception 'An active employee profile is required to view shift history.' using errcode = '42501';
  end if;

  can_manage_settings := (select private.has_permission(target_organization_id, 'settings.manage'));
  can_view_history := (select private.has_permission(target_organization_id, 'shifts.view_history'));
  if not can_manage_settings and not can_view_history then
    raise exception 'Shift history permission is required.' using errcode = '42501';
  end if;

  return query
  select
    shift.id,
    shift.store_id,
    shift.register_id,
    shift.opened_by_employee_id,
    coalesce(profile.full_name, profile.email, 'Employee'),
    shift.opening_cash_minor,
    shift.expected_cash_minor,
    shift.counted_cash_minor,
    shift.difference_minor,
    shift.opening_note,
    shift.closing_note,
    shift.opened_at,
    shift.closed_at
  from public.shifts shift
  left join public.employees employee
    on employee.id = shift.opened_by_employee_id
   and employee.organization_id = shift.organization_id
  left join public.profiles profile on profile.id = employee.profile_id
  where shift.organization_id = target_organization_id
    and shift.status = 'closed'
    and (
      can_manage_settings
      or exists (
        select 1
        from public.employee_stores employee_store
        where employee_store.organization_id = target_organization_id
          and employee_store.employee_id = viewer_employee_id
          and employee_store.store_id = shift.store_id
      )
    )
  order by shift.closed_at desc, shift.id desc
  limit target_limit;
end;
$$;

revoke all on function public.get_shift_audit_history(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_shift_audit_history(uuid, integer)
  to authenticated;

commit;
