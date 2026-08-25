-- PostgreSQL evaluates policy expressions as the calling role. Even when a
-- predicate is SECURITY DEFINER, that role still needs EXECUTE permission to
-- enter the function before its definer privileges take effect.
--
-- These helpers remain in the unexposed private schema and return only
-- auth.uid()-scoped booleans. Granting these exact signatures is the minimum
-- privilege needed for authenticated RLS evaluation.
grant usage on schema private to authenticated;

revoke execute on function private.is_organization_creator(uuid)
from public, anon, service_role;
revoke execute on function private.is_organization_member(uuid)
from public, anon, service_role;
revoke execute on function private.has_permission(uuid, text)
from public, anon, service_role;
revoke execute on function private.can_view_employee_profile(uuid)
from public, anon, service_role;
revoke execute on function private.can_grant_role(uuid, uuid)
from public, anon, service_role;

grant execute on function private.is_organization_creator(uuid)
to authenticated;
grant execute on function private.is_organization_member(uuid)
to authenticated;
grant execute on function private.has_permission(uuid, text)
to authenticated;
grant execute on function private.can_view_employee_profile(uuid)
to authenticated;
grant execute on function private.can_grant_role(uuid, uuid)
to authenticated;
