-- Wrap the existing report composer with an assigned-store authorization gate.
begin;

alter function public.get_shift_audit_report(uuid, uuid)
  rename to get_shift_audit_report_internal;

revoke all on function public.get_shift_audit_report_internal(uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.get_shift_audit_report(
  target_organization_id uuid,
  target_shift_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  viewer_employee_id uuid;
  target_store_id uuid;
begin
  if target_organization_id is null or target_shift_id is null then
    raise exception 'The shift audit report request is invalid.' using errcode = '23514';
  end if;

  if (select auth.uid()) is null then
    raise exception 'Sign in is required to view a shift audit report.' using errcode = '42501';
  end if;

  if not (select private.has_permission(target_organization_id, 'settings.manage'))
     and not (select private.has_permission(target_organization_id, 'shifts.view_history')) then
    raise exception 'Shift history permission is required.' using errcode = '42501';
  end if;

  select private.current_employee_id(target_organization_id) into viewer_employee_id;
  select shift.store_id into target_store_id
  from public.shifts shift
  where shift.id = target_shift_id
    and shift.organization_id = target_organization_id
    and shift.status = 'closed';

  if viewer_employee_id is null or target_store_id is null then
    raise exception 'The closed shift was not found.' using errcode = 'P0002';
  end if;

  if not (select private.has_permission(target_organization_id, 'stores.manage'))
     and not exists (
       select 1
       from public.employee_stores assignment
       where assignment.organization_id = target_organization_id
         and assignment.employee_id = viewer_employee_id
         and assignment.store_id = target_store_id
     ) then
    raise exception 'You are not assigned to this shift store.' using errcode = '42501';
  end if;

  return public.get_shift_audit_report_internal(target_organization_id, target_shift_id);
end;
$$;

revoke all on function public.get_shift_audit_report(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_shift_audit_report(uuid, uuid)
  to authenticated;

commit;
