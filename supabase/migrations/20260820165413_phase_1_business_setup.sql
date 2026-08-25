-- TINDIO Phase 1: identity, organizations, stores, registers, employees, and RBAC.
-- This migration is additive and intentionally contains no destructive data operations.

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text not null,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_full_name_length check (char_length(full_name) <= 160),
  constraint profiles_email_length check (char_length(email) between 3 and 320),
  constraint profiles_phone_length check (phone is null or char_length(phone) <= 40),
  constraint profiles_avatar_url_length check (avatar_url is null or char_length(avatar_url) <= 2048)
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency_code text not null default 'PHP',
  timezone text not null default 'Asia/Manila',
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_name_length check (char_length(name) between 2 and 160),
  constraint organizations_currency_code_format check (currency_code ~ '^[A-Z]{3}$'),
  constraint organizations_timezone_length check (char_length(timezone) between 1 and 100)
);

create index organizations_created_by_idx on public.organizations (created_by);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null,
  code text not null,
  address text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stores_id_organization_unique unique (id, organization_id),
  constraint stores_name_length check (char_length(name) between 2 and 160),
  constraint stores_code_format check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,31}$'),
  constraint stores_address_length check (address is null or char_length(address) <= 500),
  constraint stores_phone_length check (phone is null or char_length(phone) <= 40),
  constraint stores_organization_code_unique unique (organization_id, code)
);

create index stores_organization_id_idx on public.stores (organization_id);
create unique index stores_organization_name_unique_idx
  on public.stores (organization_id, lower(name));

create table public.registers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  store_id uuid not null,
  name text not null,
  code text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint registers_id_organization_unique unique (id, organization_id),
  constraint registers_store_organization_fkey
    foreign key (store_id, organization_id)
    references public.stores (id, organization_id)
    on delete restrict,
  constraint registers_name_length check (char_length(name) between 2 and 160),
  constraint registers_code_format check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,31}$'),
  constraint registers_store_code_unique unique (store_id, code)
);

create index registers_organization_id_idx on public.registers (organization_id);
create index registers_store_id_idx on public.registers (store_id);
create unique index registers_store_name_unique_idx
  on public.registers (store_id, lower(name));

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  profile_id uuid not null references public.profiles (id) on delete restrict,
  employee_number text not null,
  job_title text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employees_id_organization_unique unique (id, organization_id),
  constraint employees_organization_profile_unique unique (organization_id, profile_id),
  constraint employees_organization_number_unique unique (organization_id, employee_number),
  constraint employees_number_format check (employee_number ~ '^[A-Z0-9][A-Z0-9_-]{1,31}$'),
  constraint employees_job_title_length check (job_title is null or char_length(job_title) <= 120),
  constraint employees_status_values check (status in ('active', 'inactive', 'suspended'))
);

create index employees_profile_id_idx on public.employees (profile_id);
create index employees_organization_status_idx on public.employees (organization_id, status);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null,
  code text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roles_id_organization_unique unique (id, organization_id),
  constraint roles_organization_code_unique unique (organization_id, code),
  constraint roles_name_length check (char_length(name) between 2 and 80),
  constraint roles_code_format check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint roles_description_length check (description is null or char_length(description) <= 500)
);

create index roles_organization_id_idx on public.roles (organization_id);
create unique index roles_organization_name_unique_idx
  on public.roles (organization_id, lower(name));

create table public.permissions (
  code text primary key,
  category text not null,
  name text not null,
  description text not null,
  constraint permissions_code_format check (code ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  constraint permissions_category_length check (char_length(category) between 2 and 60),
  constraint permissions_name_length check (char_length(name) between 2 and 100),
  constraint permissions_description_length check (char_length(description) between 2 and 500)
);

create table public.employee_stores (
  organization_id uuid not null references public.organizations (id) on delete restrict,
  employee_id uuid not null,
  store_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (employee_id, store_id),
  constraint employee_stores_employee_organization_fkey
    foreign key (employee_id, organization_id)
    references public.employees (id, organization_id)
    on delete cascade,
  constraint employee_stores_store_organization_fkey
    foreign key (store_id, organization_id)
    references public.stores (id, organization_id)
    on delete cascade
);

create index employee_stores_organization_id_idx on public.employee_stores (organization_id);
create index employee_stores_store_id_idx on public.employee_stores (store_id);

create table public.role_permissions (
  organization_id uuid not null references public.organizations (id) on delete restrict,
  role_id uuid not null,
  permission_code text not null references public.permissions (code) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_code),
  constraint role_permissions_role_organization_fkey
    foreign key (role_id, organization_id)
    references public.roles (id, organization_id)
    on delete cascade
);

create index role_permissions_organization_id_idx on public.role_permissions (organization_id);
create index role_permissions_permission_code_idx on public.role_permissions (permission_code);

create table public.employee_roles (
  organization_id uuid not null references public.organizations (id) on delete restrict,
  employee_id uuid not null,
  role_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (employee_id, role_id),
  constraint employee_roles_employee_organization_fkey
    foreign key (employee_id, organization_id)
    references public.employees (id, organization_id)
    on delete cascade,
  constraint employee_roles_role_organization_fkey
    foreign key (role_id, organization_id)
    references public.roles (id, organization_id)
    on delete cascade
);

create index employee_roles_organization_id_idx on public.employee_roles (organization_id);
create index employee_roles_role_id_idx on public.employee_roles (role_id);

insert into public.permissions (code, category, name, description)
values
  ('sales.create', 'Sales', 'Create sales', 'Create and complete point-of-sale transactions.'),
  ('sales.refund', 'Sales', 'Refund sales', 'Create full or partial refunds against completed sales.'),
  ('discounts.apply', 'Sales', 'Apply discounts', 'Apply permitted item or order discounts.'),
  ('prices.override', 'Sales', 'Override prices', 'Override the configured selling price during a sale.'),
  ('receipts.view', 'Sales', 'View receipts', 'View completed receipt history and details.'),
  ('receipts.reprint', 'Sales', 'Reprint receipts', 'Reprint completed transaction receipts.'),
  ('shifts.open', 'Register', 'Open shifts', 'Open a register shift.'),
  ('shifts.close', 'Register', 'Close shifts', 'Count and close a register shift.'),
  ('cash.pay_in', 'Register', 'Record pay-ins', 'Record cash added to an open shift.'),
  ('cash.pay_out', 'Register', 'Record pay-outs', 'Record cash removed from an open shift.'),
  ('products.manage', 'Catalog', 'Manage products', 'Create and maintain products and categories.'),
  ('products.view_cost', 'Catalog', 'View product cost', 'View product acquisition cost and margins.'),
  ('inventory.manage', 'Inventory', 'Manage inventory', 'Perform authorized stock operations.'),
  ('customers.manage', 'Customers', 'Manage customers', 'Create and maintain customer profiles.'),
  ('employees.manage', 'Team', 'Manage employees', 'Create and maintain employee access and assignments.'),
  ('roles.manage', 'Team', 'Manage roles', 'Create roles and assign permissions.'),
  ('reports.view', 'Reports', 'View reports', 'View authorized business reports.'),
  ('stores.manage', 'Management', 'Manage stores', 'Create and maintain stores.'),
  ('registers.manage', 'Management', 'Manage registers', 'Create and maintain POS registers.'),
  ('organization.manage', 'Management', 'Manage organization', 'Manage organization-level business settings.'),
  ('settings.manage', 'Management', 'Manage settings', 'Manage business configuration.'),
  ('dashboard.view', 'Management', 'View dashboard', 'View the Back Office dashboard.')
on conflict (code) do update
set
  category = excluded.category,
  name = excluded.name,
  description = excluded.description;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function private.set_updated_at() from public, anon, authenticated, service_role;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function private.set_updated_at();

create trigger stores_set_updated_at
before update on public.stores
for each row execute function private.set_updated_at();

create trigger registers_set_updated_at
before update on public.registers
for each row execute function private.set_updated_at();

create trigger employees_set_updated_at
before update on public.employees
for each row execute function private.set_updated_at();

create trigger roles_set_updated_at
before update on public.roles
for each row execute function private.set_updated_at();

create or replace function private.sync_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 160),
    lower(coalesce(new.email, ''))
  )
  on conflict (id) do update
  set
    full_name = case
      when coalesce(excluded.full_name, '') = '' then public.profiles.full_name
      else excluded.full_name
    end,
    email = excluded.email,
    updated_at = now();

  return new;
end;
$$;

revoke execute on function private.sync_auth_user_profile() from public, anon, authenticated, service_role;

create trigger auth_user_profile_sync
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function private.sync_auth_user_profile();

create or replace function private.is_organization_creator(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.organizations organization
      where organization.id = target_organization_id
        and organization.created_by = (select auth.uid())
    );
$$;

create or replace function private.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.employees employee
      where employee.organization_id = target_organization_id
        and employee.profile_id = (select auth.uid())
        and employee.status = 'active'
    );
$$;

create or replace function private.has_permission(
  target_organization_id uuid,
  requested_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.employees employee
      join public.employee_roles employee_role
        on employee_role.employee_id = employee.id
       and employee_role.organization_id = employee.organization_id
      join public.role_permissions role_permission
        on role_permission.role_id = employee_role.role_id
       and role_permission.organization_id = employee_role.organization_id
      where employee.organization_id = target_organization_id
        and employee.profile_id = (select auth.uid())
        and employee.status = 'active'
        and role_permission.permission_code = requested_permission
    );
$$;

create or replace function private.can_view_employee_profile(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    target_profile_id = (select auth.uid())
    or exists (
      select 1
      from public.employees target_employee
      where target_employee.profile_id = target_profile_id
        and (select private.has_permission(
          target_employee.organization_id,
          'employees.manage'
        ))
    );
$$;

revoke execute on function private.is_organization_creator(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.is_organization_member(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.has_permission(uuid, text) from public, anon, authenticated, service_role;
revoke execute on function private.can_view_employee_profile(uuid) from public, anon, authenticated, service_role;

-- Authenticated callers need to execute these predicates through RLS. The
-- private schema is not exposed through the Data API, so none are RPC routes.
grant usage on schema private to authenticated;
grant execute on function private.is_organization_creator(uuid) to authenticated;
grant execute on function private.is_organization_member(uuid) to authenticated;
grant execute on function private.has_permission(uuid, text) to authenticated;
grant execute on function private.can_view_employee_profile(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.stores enable row level security;
alter table public.registers enable row level security;
alter table public.employees enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.employee_stores enable row level security;
alter table public.role_permissions enable row level security;
alter table public.employee_roles enable row level security;

create policy profiles_select_own
on public.profiles for select
to authenticated
using (id = (select auth.uid()));

create policy profiles_select_managed_employees
on public.profiles for select
to authenticated
using ((select private.can_view_employee_profile(id)));

create policy profiles_update_own
on public.profiles for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy organizations_select_member
on public.organizations for select
to authenticated
using (
  (select private.is_organization_member(id))
  or created_by = (select auth.uid())
);

create policy organizations_insert_authenticated
on public.organizations for insert
to authenticated
with check (created_by = (select auth.uid()));

create policy organizations_update_authorized
on public.organizations for update
to authenticated
using ((select private.has_permission(id, 'organization.manage')))
with check ((select private.has_permission(id, 'organization.manage')));

create policy stores_select_member
on public.stores for select
to authenticated
using (
  (select private.is_organization_member(organization_id))
  or (select private.is_organization_creator(organization_id))
);

create policy stores_insert_authorized
on public.stores for insert
to authenticated
with check (
  (select private.is_organization_creator(organization_id))
  or (select private.has_permission(organization_id, 'stores.manage'))
);

create policy stores_update_authorized
on public.stores for update
to authenticated
using ((select private.has_permission(organization_id, 'stores.manage')))
with check ((select private.has_permission(organization_id, 'stores.manage')));

create policy registers_select_member
on public.registers for select
to authenticated
using (
  (select private.is_organization_member(organization_id))
  or (select private.is_organization_creator(organization_id))
);

create policy registers_insert_authorized
on public.registers for insert
to authenticated
with check (
  (select private.is_organization_creator(organization_id))
  or (select private.has_permission(organization_id, 'registers.manage'))
);

create policy registers_update_authorized
on public.registers for update
to authenticated
using ((select private.has_permission(organization_id, 'registers.manage')))
with check ((select private.has_permission(organization_id, 'registers.manage')));

create policy employees_select_authorized
on public.employees for select
to authenticated
using (
  profile_id = (select auth.uid())
  or (select private.has_permission(organization_id, 'employees.manage'))
);

create policy employees_insert_authorized
on public.employees for insert
to authenticated
with check (
  (select private.is_organization_creator(organization_id))
  or (select private.has_permission(organization_id, 'employees.manage'))
);

create policy employees_update_authorized
on public.employees for update
to authenticated
using ((select private.has_permission(organization_id, 'employees.manage')))
with check ((select private.has_permission(organization_id, 'employees.manage')));

create policy roles_select_member
on public.roles for select
to authenticated
using (
  (select private.is_organization_member(organization_id))
  or (select private.is_organization_creator(organization_id))
);

create policy roles_insert_authorized
on public.roles for insert
to authenticated
with check (
  (select private.is_organization_creator(organization_id))
  or (select private.has_permission(organization_id, 'roles.manage'))
);

create policy roles_update_authorized
on public.roles for update
to authenticated
using ((select private.has_permission(organization_id, 'roles.manage')))
with check ((select private.has_permission(organization_id, 'roles.manage')));

create policy permissions_select_authenticated
on public.permissions for select
to authenticated
using (true);

create policy employee_stores_select_authorized
on public.employee_stores for select
to authenticated
using (
  exists (
    select 1
    from public.employees employee
    where employee.id = employee_stores.employee_id
      and employee.profile_id = (select auth.uid())
  )
  or (select private.has_permission(organization_id, 'employees.manage'))
);

create policy employee_stores_insert_authorized
on public.employee_stores for insert
to authenticated
with check (
  (select private.is_organization_creator(organization_id))
  or (select private.has_permission(organization_id, 'employees.manage'))
);

create policy employee_stores_delete_authorized
on public.employee_stores for delete
to authenticated
using ((select private.has_permission(organization_id, 'employees.manage')));

create policy role_permissions_select_member
on public.role_permissions for select
to authenticated
using ((select private.is_organization_member(organization_id)));

create policy role_permissions_insert_authorized
on public.role_permissions for insert
to authenticated
with check (
  (select private.is_organization_creator(organization_id))
  or (select private.has_permission(organization_id, 'roles.manage'))
);

create policy role_permissions_delete_authorized
on public.role_permissions for delete
to authenticated
using ((select private.has_permission(organization_id, 'roles.manage')));

create policy employee_roles_select_authorized
on public.employee_roles for select
to authenticated
using (
  exists (
    select 1
    from public.employees employee
    where employee.id = employee_roles.employee_id
      and employee.profile_id = (select auth.uid())
  )
  or (select private.has_permission(organization_id, 'employees.manage'))
);

create policy employee_roles_insert_authorized
on public.employee_roles for insert
to authenticated
with check (
  (select private.is_organization_creator(organization_id))
  or (select private.has_permission(organization_id, 'employees.manage'))
);

create policy employee_roles_delete_authorized
on public.employee_roles for delete
to authenticated
using ((select private.has_permission(organization_id, 'employees.manage')));

grant usage on schema public to authenticated;

revoke all on public.profiles from anon, authenticated;
revoke all on public.organizations from anon, authenticated;
revoke all on public.stores from anon, authenticated;
revoke all on public.registers from anon, authenticated;
revoke all on public.employees from anon, authenticated;
revoke all on public.roles from anon, authenticated;
revoke all on public.permissions from anon, authenticated;
revoke all on public.employee_stores from anon, authenticated;
revoke all on public.role_permissions from anon, authenticated;
revoke all on public.employee_roles from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (full_name, phone, avatar_url) on public.profiles to authenticated;
grant select, insert on public.organizations to authenticated;
grant update (name, currency_code, timezone) on public.organizations to authenticated;
grant select, insert on public.stores to authenticated;
grant update (name, code, address, phone, is_active) on public.stores to authenticated;
grant select, insert on public.registers to authenticated;
grant update (name, code, is_active) on public.registers to authenticated;
grant select, insert on public.employees to authenticated;
grant update (employee_number, job_title, status) on public.employees to authenticated;
grant select, insert on public.roles to authenticated;
grant update (name, description) on public.roles to authenticated;
grant select on public.permissions to authenticated;
grant select, insert, delete on public.employee_stores to authenticated;
grant select, insert, delete on public.role_permissions to authenticated;
grant select, insert, delete on public.employee_roles to authenticated;

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

  if exists (
    select 1
    from public.employees employee
    where employee.profile_id = current_user_id
  ) then
    raise exception 'This account already belongs to an organization.' using errcode = '23505';
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
  values (
    normalized_organization_name,
    normalized_currency_code,
    normalized_timezone,
    current_user_id
  )
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
  from public.permissions permission;

  insert into public.role_permissions (organization_id, role_id, permission_code)
  select new_organization_id, admin_role_id, permission.code
  from public.permissions permission
  where permission.code <> 'organization.manage';

  insert into public.role_permissions (organization_id, role_id, permission_code)
  select new_organization_id, manager_role_id, permission.code
  from public.permissions permission
  where permission.code in (
    'sales.create', 'sales.refund', 'discounts.apply', 'prices.override',
    'receipts.view', 'receipts.reprint', 'shifts.open', 'shifts.close',
    'cash.pay_in', 'cash.pay_out', 'products.manage', 'products.view_cost',
    'inventory.manage', 'customers.manage', 'employees.manage',
    'reports.view', 'registers.manage', 'dashboard.view'
  );

  insert into public.role_permissions (organization_id, role_id, permission_code)
  select new_organization_id, cashier_role_id, permission.code
  from public.permissions permission
  where permission.code in (
    'sales.create', 'discounts.apply', 'receipts.view', 'receipts.reprint',
    'shifts.open', 'shifts.close', 'cash.pay_in', 'cash.pay_out'
  );

  insert into public.role_permissions (organization_id, role_id, permission_code)
  select new_organization_id, inventory_role_id, permission.code
  from public.permissions permission
  where permission.code in (
    'products.manage', 'products.view_cost', 'inventory.manage'
  );

  insert into public.stores (organization_id, name, code)
  values (new_organization_id, normalized_store_name, 'MAIN')
  returning id into new_store_id;

  insert into public.registers (organization_id, store_id, name, code)
  values (new_organization_id, new_store_id, normalized_register_name, 'REG-01')
  returning id into new_register_id;

  insert into public.employees (
    organization_id,
    profile_id,
    employee_number,
    job_title
  )
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

  return query
  select new_organization_id, new_store_id, new_register_id;
end;
$$;

revoke execute on function public.bootstrap_organization(text, text, text, text, text)
from public, anon;

grant execute on function public.bootstrap_organization(text, text, text, text, text)
to authenticated;

comment on function public.bootstrap_organization(text, text, text, text, text)
is 'Atomically creates an organization, starter roles, the owner employee, one store, and one register under invoker RLS.';
