-- Companion to Improvement Phase 16: expose only the minimum owner/admin
-- readiness flags needed by the paused-organization screen. It never returns
-- tenant records and continues to reject cross-organization lookups.

begin;

create or replace function public.get_organization_readiness_access(target_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_organization_membership(target_organization_id) then
    raise exception 'You do not have access to this organization.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'can_export', private.has_organization_export_access(target_organization_id),
    'can_manage_lifecycle', private.has_organization_lifecycle_access(target_organization_id)
  );
end;
$$;

revoke execute on function public.get_organization_readiness_access(uuid) from public, anon, service_role;
grant execute on function public.get_organization_readiness_access(uuid) to authenticated;

comment on function public.get_organization_readiness_access(uuid) is 'Returns only tenant lifecycle/export capability flags for the current member; normal operational data remains inaccessible while suspended or archived.';

notify pgrst, 'reload schema';

commit;
