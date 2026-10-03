-- Back Office time-and-attendance audit is a Team management responsibility.
-- Attendance remains store-scoped: this adds no mutation authority and does
-- not change the employee self-service visibility rule.

begin;

drop policy if exists time_clock_entries_select_self_or_settings_manager on public.time_clock_entries;
create policy time_clock_entries_select_self_or_settings_manager on public.time_clock_entries
  for select to authenticated
  using (
    employee_id = (select private.current_employee_id(organization_id))
    or (
      (
        (select private.has_permission(organization_id, 'settings.manage'))
        or (select private.has_permission(organization_id, 'employees.manage'))
      )
      and (select private.has_store_read_scope(organization_id, store_id))
    )
  );

commit;
