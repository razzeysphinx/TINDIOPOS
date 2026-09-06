-- System-role capability triggers may add a permission while the organization
-- bootstrap function is creating its preset roles. Keep the canonical preset
-- bundles intact while making that provisioning order-independent.
begin;

create or replace function public.bootstrap_organization(
  organization_name text,
  store_name text,
  register_name text,
  currency_code text default 'PHP',
  timezone_name text default 'Asia/Manila'
)
returns table (
  organization_id uuid,
  store_id uuid,
  register_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_organization_name text := btrim(organization_name);
  normalized_store_name text := btrim(store_name);
  normalized_register_name text := btrim(register_name);
  normalized_currency_code text := upper(btrim(currency_code));
  normalized_timezone text := btrim(timezone_name);
  new_organization_id uuid;
  new_store_id uuid;
  new_register_id uuid;
  new_employee_id uuid;
  owner_role_id uuid;
  admin_role_id uuid;
  manager_role_id uuid;
  cashier_role_id uuid;
  inventory_role_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if char_length(normalized_organization_name) not between 2 and 160 then
    raise exception 'Organization name must contain between 2 and 160 characters.' using errcode = '22023';
  end if;

  if char_length(normalized_store_name) not between 2 and 160 then
    raise exception 'Store name must contain between 2 and 160 characters.' using errcode = '22023';
  end if;

  if char_length(normalized_register_name) not between 2 and 160 then
    raise exception 'Register name must contain between 2 and 160 characters.' using errcode = '22023';
  end if;

  if normalized_currency_code !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be a three-letter ISO code.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_timezone_names where name = normalized_timezone
  ) then
    raise exception 'Timezone is not recognized by PostgreSQL.' using errcode = '22023';
  end if;

  insert into public.organizations (name, currency_code, timezone, created_by)
  values (normalized_organization_name, normalized_currency_code, normalized_timezone, current_user_id)
  returning id into new_organization_id;

  insert into public.roles (organization_id, name, code, description, is_system)
  values (new_organization_id, 'Owner', 'owner', 'Full organization ownership.', true)
  returning id into owner_role_id;
  insert into public.roles (organization_id, name, code, description, is_system)
  values (new_organization_id, 'Admin', 'admin', 'Administrative access without ownership controls.', true)
  returning id into admin_role_id;
  insert into public.roles (organization_id, name, code, description, is_system)
  values (new_organization_id, 'Manager', 'manager', 'Store management and operational oversight.', true)
  returning id into manager_role_id;
  insert into public.roles (organization_id, name, code, description, is_system)
  values (new_organization_id, 'Cashier', 'cashier', 'Point-of-sale and register operations.', true)
  returning id into cashier_role_id;
  insert into public.roles (organization_id, name, code, description, is_system)
  values (new_organization_id, 'Inventory Staff', 'inventory_staff', 'Product and inventory operations.', true)
  returning id into inventory_role_id;

  insert into public.role_permissions (organization_id, role_id, permission_code)
  select new_organization_id, owner_role_id, permission.code
  from public.permissions permission
  on conflict do nothing;

  insert into public.role_permissions (organization_id, role_id, permission_code)
  select new_organization_id, admin_role_id, permission.code
  from public.permissions permission
  where permission.code not in ('organization.manage', 'organization.archive', 'organization.lifecycle', 'recovery.manage')
  on conflict do nothing;

  insert into public.role_permissions (organization_id, role_id, permission_code)
  select new_organization_id, manager_role_id, permission.code
  from public.permissions permission
  where permission.code in (
    'sales.create', 'sales.refund', 'discounts.apply', 'prices.override',
    'receipts.view', 'receipts.reprint', 'shifts.open', 'shifts.close',
    'cash.pay_in', 'cash.pay_out', 'products.manage', 'products.view_cost',
    'inventory.manage', 'customers.manage', 'employees.manage',
    'reports.view', 'registers.manage', 'dashboard.view',
    'kitchen.view', 'kitchen.manage', 'pos.access', 'pos.edit_quantity',
    'pos.remove_item', 'payments.accept', 'tickets.manage', 'cash_drawer.open',
    'shifts.view_expected_cash', 'shifts.view_history', 'shifts.force_close',
    'inventory.view', 'inventory.adjust', 'inventory.count', 'inventory.receive',
    'inventory.purchase_orders', 'inventory.transfers', 'inventory.suppliers',
    'approvals.request', 'approvals.authorize', 'audit.view'
  )
  on conflict do nothing;

  insert into public.role_permissions (organization_id, role_id, permission_code)
  select new_organization_id, cashier_role_id, permission.code
  from public.permissions permission
  where permission.code in (
    'sales.create', 'discounts.apply', 'receipts.view', 'receipts.reprint',
    'shifts.open', 'shifts.close', 'cash.pay_in', 'cash.pay_out',
    'pos.access', 'pos.edit_quantity', 'pos.remove_item', 'payments.accept',
    'approvals.request'
  )
  on conflict do nothing;

  insert into public.role_permissions (organization_id, role_id, permission_code)
  select new_organization_id, inventory_role_id, permission.code
  from public.permissions permission
  where permission.code in (
    'products.manage', 'products.view_cost', 'inventory.manage',
    'inventory.view', 'inventory.adjust', 'inventory.count', 'inventory.receive',
    'inventory.purchase_orders', 'inventory.transfers', 'inventory.suppliers',
    'approvals.request'
  )
  on conflict do nothing;

  insert into public.stores (organization_id, name, code)
  values (new_organization_id, normalized_store_name, 'MAIN')
  returning id into new_store_id;
  insert into public.registers (organization_id, store_id, name, code)
  values (new_organization_id, new_store_id, normalized_register_name, 'REG-01')
  returning id into new_register_id;
  insert into public.employees (organization_id, profile_id, employee_number, job_title)
  values (
    new_organization_id,
    current_user_id,
    'OWNER-' || upper(substr(replace(current_user_id::text, '-', ''), 1, 8)),
    'Owner'
  )
  returning id into new_employee_id;
  insert into public.employee_roles (organization_id, employee_id, role_id)
  values (new_organization_id, new_employee_id, owner_role_id);
  insert into public.employee_stores (organization_id, employee_id, store_id)
  values (new_organization_id, new_employee_id, new_store_id);

  return query select new_organization_id, new_store_id, new_register_id;
end;
$$;

comment on function public.bootstrap_organization(text, text, text, text, text)
is 'Atomically creates an independent organization, starter roles, owner, store, and register. Preset bundles remain idempotent when system-role capability triggers pre-provision permissions.';

commit;
