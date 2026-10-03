-- Repair the starter-role lists after the Phase 16 bootstrap replacement.
-- Earlier phases extended these defaults by rewriting the routine; retain each
-- least-privilege grant while allowing one profile to create multiple tenants.

begin;

create or replace function private.seed_system_role_permission_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.role_permissions (organization_id, role_id, permission_code)
  select role.organization_id, role.id, permission.code
  from public.roles role
  join public.permissions permission on true
  where role.organization_id = new.organization_id
    and role.is_system
    and ((role.code = 'owner')
     or (role.code = 'admin' and permission.code not in ('organization.manage', 'organization.archive', 'organization.lifecycle'))
     or (role.code = 'manager' and permission.code in (
       'sales.create', 'sales.refund', 'discounts.apply', 'prices.override',
       'receipts.view', 'receipts.reprint', 'shifts.open', 'shifts.close',
       'cash.pay_in', 'cash.pay_out', 'products.manage', 'products.view_cost',
       'inventory.manage', 'customers.manage', 'employees.manage', 'reports.view',
       'registers.manage', 'dashboard.view', 'kitchen.view', 'kitchen.manage',
       'pos.access', 'pos.edit_quantity', 'pos.remove_item', 'payments.accept',
       'tickets.manage', 'cash_drawer.open', 'shifts.view_expected_cash',
       'shifts.view_history', 'shifts.force_close', 'inventory.view',
       'inventory.adjust', 'inventory.count', 'inventory.receive',
       'inventory.purchase_orders', 'inventory.transfers', 'inventory.suppliers',
       'approvals.request', 'approvals.authorize', 'audit.view'
     ))
     or (role.code = 'cashier' and permission.code in (
       'sales.create', 'discounts.apply', 'receipts.view', 'receipts.reprint',
       'shifts.open', 'shifts.close', 'cash.pay_in', 'cash.pay_out', 'pos.access',
       'pos.edit_quantity', 'pos.remove_item', 'payments.accept', 'approvals.request'
     ))
     or (role.code = 'inventory_staff' and permission.code in (
       'products.manage', 'products.view_cost', 'inventory.manage', 'inventory.view',
       'inventory.adjust', 'inventory.count', 'inventory.receive',
       'inventory.purchase_orders', 'inventory.transfers', 'inventory.suppliers',
       'approvals.request'
     )))
  on conflict do nothing;

  return new;
end;
$$;

revoke execute on function private.seed_system_role_permission_defaults() from public, anon, authenticated, service_role;

drop trigger if exists roles_seed_system_permission_defaults on public.roles;
drop trigger if exists organizations_seed_system_permission_defaults on public.organizations;
drop trigger if exists employee_roles_seed_system_permission_defaults on public.employee_roles;
create trigger employee_roles_seed_system_permission_defaults
after insert on public.employee_roles
for each row execute function private.seed_system_role_permission_defaults();

comment on function public.bootstrap_organization(text, text, text, text, text) is 'Atomically creates an independent organization, starter roles, owner, store, and register. A profile may safely own or work for multiple tenant-isolated organizations.';

notify pgrst, 'reload schema';

commit;
