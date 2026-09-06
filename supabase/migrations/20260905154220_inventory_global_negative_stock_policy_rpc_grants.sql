-- The public security-invoker wrappers intentionally delegate to private
-- guarded functions. Explicitly grant only those two private implementations
-- to authenticated callers; the private schema is not exposed by the Data API
-- and each function still checks the authenticated employee, capability, and
-- relevant organization/store scope before changing data.
begin;

grant execute on function private.update_organization_inventory_policy(uuid,text)
to authenticated;
grant execute on function private.remove_inventory_policy_override(uuid,uuid)
to authenticated;

notify pgrst, 'reload schema';

commit;
