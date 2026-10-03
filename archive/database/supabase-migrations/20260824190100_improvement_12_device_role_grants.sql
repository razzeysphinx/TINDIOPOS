-- Phase 12 compatibility: Owner and Admin were seeded before devices.manage
-- existed, so explicitly grant the new management permission to every tenant.

begin;

insert into public.role_permissions (organization_id, role_id, permission_code)
select role.organization_id, role.id, 'devices.manage'
from public.roles role
where role.code in ('owner', 'admin')
on conflict do nothing;

commit;
