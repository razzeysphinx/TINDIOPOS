begin;

-- The public entry point validates every caller through the private
-- capability/store-scope guard. That guard is deliberately not executable by
-- authenticated users, so the public wrapper must retain the controlled
-- definer boundary rather than execute as the caller.
alter function public.update_employee_assignments(uuid, uuid, text, text, uuid[], uuid[])
  security definer;
alter function public.update_employee_assignments(uuid, uuid, text, text, uuid[], uuid[])
  set search_path = '';

revoke execute on function public.update_employee_assignments(uuid, uuid, text, text, uuid[], uuid[])
from public, anon, service_role;
grant execute on function public.update_employee_assignments(uuid, uuid, text, text, uuid[], uuid[])
to authenticated;

comment on function public.update_employee_assignments(uuid, uuid, text, text, uuid[], uuid[])
is 'Controlled employee-assignment entry point. Runs as definer solely to call the private authorization guard; the guard still requires the caller authentication, employees.manage, organization/store scope, and anti-escalation checks.';

commit;
