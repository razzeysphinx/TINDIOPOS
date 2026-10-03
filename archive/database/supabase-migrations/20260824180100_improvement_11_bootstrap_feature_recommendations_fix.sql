-- Ensure the new-organization wrapper can read the private recommendation
-- helper while the helper itself remains unavailable to application callers.
alter function public.bootstrap_organization_v2(text, text, text, text, text, text)
  security definer;

revoke execute on function public.bootstrap_organization_v2(text, text, text, text, text, text)
  from public, anon, service_role;
grant execute on function public.bootstrap_organization_v2(text, text, text, text, text, text)
  to authenticated;
