-- TINDIO Improvement 1: additive employee security, manager approvals, and audit trail.
--
-- This extends the existing employee / role / permission architecture. It does
-- not replace Supabase Auth, mutate historical business records, or grant a
-- cashier a manager role. A manager PIN authorizes one exact pending request.

begin;

insert into public.permissions (code, category, name, description)
values
  ('pos.access', 'POS', 'Access POS', 'Open the point-of-sale workspace.'),
  ('pos.edit_quantity', 'POS', 'Edit cart quantities', 'Change a temporary POS cart quantity.'),
  ('pos.remove_item', 'POS', 'Remove cart items', 'Remove an item from a temporary POS cart.'),
  ('payments.accept', 'POS', 'Accept payments', 'Complete an eligible POS payment.'),
  ('tickets.manage', 'POS', 'Manage open tickets', 'Create, update, complete, or cancel open tickets.'),
  ('cash_drawer.open', 'POS', 'Open cash drawer', 'Record an authorized cash-drawer opening.'),
  ('shifts.view_expected_cash', 'Register', 'View expected cash', 'View calculated expected drawer cash.'),
  ('shifts.view_history', 'Register', 'View shift history', 'View closed register shift history.'),
  ('shifts.force_close', 'Register', 'Force close shift', 'Force-close a shift after explicit manager approval.'),
  ('inventory.view', 'Inventory', 'View inventory', 'View stock projections and movement history.'),
  ('inventory.adjust', 'Inventory', 'Adjust inventory', 'Create an inventory adjustment.'),
  ('inventory.count', 'Inventory', 'Perform counts', 'Complete an inventory count.'),
  ('inventory.receive', 'Inventory', 'Receive inventory', 'Receive a purchase order.'),
  ('inventory.purchase_orders', 'Inventory', 'Manage purchase orders', 'Create and maintain purchase orders.'),
  ('inventory.transfers', 'Inventory', 'Manage transfers', 'Transfer stock between assigned stores.'),
  ('inventory.suppliers', 'Inventory', 'Manage suppliers', 'Create and maintain suppliers.'),
  ('devices.manage', 'Management', 'Manage devices', 'Manage registered TINDIO devices when device management is enabled.'),
  ('approvals.request', 'Security', 'Request manager approval', 'Request a scoped approval for a restricted operation.'),
  ('approvals.authorize', 'Security', 'Authorize manager approvals', 'Approve a requested operation with a secure manager PIN.'),
  ('approvals.manage', 'Security', 'Manage approval rules', 'Configure organization approval rules.'),
  ('approvals.bypass', 'Security', 'Bypass approval rules', 'Perform a restricted operation without a second approver.'),
  ('audit.view', 'Security', 'View audit log', 'View immutable security and approval audit records.')
on conflict (code) do update
set
  category = excluded.category,
  name = excluded.name,
  description = excluded.description;

-- Backwards-compatible grants: existing roles retain their current ability to
-- sell, while the new finer-grained catalog is available to custom roles.
insert into public.role_permissions (organization_id, role_id, permission_code)
select role.organization_id, role.id, mapping.permission_code
from public.roles role
join lateral (
  select 'pos.access'::text as permission_code
  union all select 'pos.edit_quantity'
  union all select 'pos.remove_item'
  union all select 'payments.accept'
) mapping on exists (
  select 1
  from public.role_permissions existing
  where existing.organization_id = role.organization_id
    and existing.role_id = role.id
    and existing.permission_code = 'sales.create'
)
on conflict do nothing;

insert into public.role_permissions (organization_id, role_id, permission_code)
select role.organization_id, role.id, mapping.permission_code
from public.roles role
join lateral (
  select 'inventory.view'::text as permission_code
  union all select 'inventory.adjust'
  union all select 'inventory.count'
  union all select 'inventory.receive'
  union all select 'inventory.purchase_orders'
  union all select 'inventory.transfers'
  union all select 'inventory.suppliers'
) mapping on exists (
  select 1
  from public.role_permissions existing
  where existing.organization_id = role.organization_id
    and existing.role_id = role.id
    and existing.permission_code = 'inventory.manage'
)
on conflict do nothing;

insert into public.role_permissions (organization_id, role_id, permission_code)
select role.organization_id, role.id, mapping.permission_code
from public.roles role
join lateral (
  select 'approvals.request'::text as permission_code
) mapping on role.code in ('owner', 'admin', 'manager', 'cashier', 'inventory_staff')
on conflict do nothing;

insert into public.role_permissions (organization_id, role_id, permission_code)
select role.organization_id, role.id, mapping.permission_code
from public.roles role
join lateral (
  select 'approvals.authorize'::text as permission_code
  union all select 'audit.view'
) mapping on role.code in ('owner', 'admin', 'manager')
on conflict do nothing;

insert into public.role_permissions (organization_id, role_id, permission_code)
select role.organization_id, role.id, mapping.permission_code
from public.roles role
join lateral (
  select 'approvals.manage'::text as permission_code
  union all select 'approvals.bypass'
  union all select 'audit.view'
) mapping on role.code in ('owner', 'admin')
on conflict do nothing;

create table public.approval_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  operation_code text not null,
  decision text not null default 'ALLOWED',
  amount_threshold_minor bigint,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_rules_operation_code_check check (operation_code in (
    'sales.refund',
    'cash.pay_out',
    'inventory.adjust',
    'discounts.apply',
    'prices.override',
    'cash_drawer.open',
    'shifts.force_close',
    'payments.adjust',
    'sales.void'
  )),
  constraint approval_rules_decision_check check (decision in ('ALLOWED', 'DENIED', 'APPROVAL_REQUIRED')),
  constraint approval_rules_amount_threshold_check check (amount_threshold_minor is null or amount_threshold_minor >= 0),
  constraint approval_rules_organization_operation_unique unique (organization_id, operation_code),
  constraint approval_rules_id_organization_unique unique (id, organization_id)
);

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  store_id uuid,
  register_id uuid,
  requested_by_employee_id uuid not null,
  approved_by_employee_id uuid,
  operation_code text not null,
  requested_amount_minor bigint,
  reason text not null,
  request_payload jsonb not null,
  status text not null default 'PENDING',
  execution_idempotency_key uuid,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_requests_operation_code_check check (operation_code in (
    'sales.refund',
    'cash.pay_out',
    'inventory.adjust',
    'discounts.apply',
    'prices.override',
    'cash_drawer.open',
    'shifts.force_close',
    'payments.adjust',
    'sales.void'
  )),
  constraint approval_requests_status_check check (status in ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONSUMED', 'CANCELLED')),
  constraint approval_requests_amount_check check (requested_amount_minor is null or requested_amount_minor >= 0),
  constraint approval_requests_reason_length_check check (char_length(reason) between 2 and 500),
  constraint approval_requests_payload_object_check check (jsonb_typeof(request_payload) = 'object'),
  constraint approval_requests_store_organization_fkey foreign key (store_id, organization_id)
    references public.stores (id, organization_id) on delete restrict,
  constraint approval_requests_register_organization_fkey foreign key (register_id, organization_id)
    references public.registers (id, organization_id) on delete restrict,
  constraint approval_requests_requested_employee_organization_fkey foreign key (requested_by_employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict,
  constraint approval_requests_approved_employee_organization_fkey foreign key (approved_by_employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict,
  constraint approval_requests_id_organization_unique unique (id, organization_id)
);

create index approval_requests_organization_status_requested_idx
  on public.approval_requests (organization_id, status, requested_at desc);
create index approval_requests_requested_status_idx
  on public.approval_requests (requested_by_employee_id, status, requested_at desc);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  store_id uuid,
  register_id uuid,
  actor_employee_id uuid,
  subject_employee_id uuid,
  approval_request_id uuid,
  event_type text not null,
  operation_code text,
  amount_minor bigint,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_logs_event_type_length_check check (char_length(event_type) between 2 and 100),
  constraint audit_logs_operation_code_length_check check (operation_code is null or char_length(operation_code) between 2 and 100),
  constraint audit_logs_amount_check check (amount_minor is null or amount_minor >= 0),
  constraint audit_logs_reason_length_check check (reason is null or char_length(reason) between 2 and 500),
  constraint audit_logs_metadata_object_check check (jsonb_typeof(metadata) = 'object'),
  constraint audit_logs_store_organization_fkey foreign key (store_id, organization_id)
    references public.stores (id, organization_id) on delete restrict,
  constraint audit_logs_register_organization_fkey foreign key (register_id, organization_id)
    references public.registers (id, organization_id) on delete restrict,
  constraint audit_logs_actor_employee_organization_fkey foreign key (actor_employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict,
  constraint audit_logs_subject_employee_organization_fkey foreign key (subject_employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict,
  constraint audit_logs_approval_request_organization_fkey foreign key (approval_request_id, organization_id)
    references public.approval_requests (id, organization_id) on delete restrict,
  constraint audit_logs_id_organization_unique unique (id, organization_id)
);

create index audit_logs_organization_created_idx
  on public.audit_logs (organization_id, created_at desc);
create index audit_logs_approval_request_idx
  on public.audit_logs (approval_request_id, created_at desc)
  where approval_request_id is not null;

-- PIN hashes and lockouts are intentionally held in the non-exposed private
-- schema. They are never selectable through the Data API.
create table private.employee_pin_credentials (
  employee_id uuid primary key references public.employees (id) on delete cascade,
  pin_hash text not null,
  failed_attempts integer not null default 0,
  failed_window_started_at timestamptz,
  locked_until timestamptz,
  updated_by_employee_id uuid references public.employees (id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint employee_pin_credentials_failed_attempts_check check (failed_attempts between 0 and 5),
  constraint employee_pin_credentials_hash_check check (char_length(pin_hash) >= 40)
);

alter table public.approval_rules enable row level security;
alter table public.approval_requests enable row level security;
alter table public.audit_logs enable row level security;
alter table private.employee_pin_credentials enable row level security;

create or replace function private.current_employee_id(target_organization_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select employee.id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active'
  order by employee.created_at
  limit 1;
$$;

create or replace function private.employee_has_permission(
  target_organization_id uuid,
  target_employee_id uuid,
  requested_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employees employee
    join public.employee_roles employee_role
      on employee_role.employee_id = employee.id
     and employee_role.organization_id = employee.organization_id
    join public.role_permissions role_permission
      on role_permission.role_id = employee_role.role_id
     and role_permission.organization_id = employee_role.organization_id
    where employee.id = target_employee_id
      and employee.organization_id = target_organization_id
      and employee.status = 'active'
      and role_permission.permission_code = requested_permission
  );
$$;

-- This expands the existing predicate only for a transaction-local approval
-- context created by private.activate_manager_approval. Browser clients cannot
-- set this context through the Data API, and it expires with the transaction.
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
    (
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
      )
    )
    or (
      (select auth.uid()) is not null
      and current_setting('tindio.approval_profile_id', true) = (select auth.uid())::text
      and current_setting('tindio.approval_organization_id', true) = target_organization_id::text
      and current_setting('tindio.approval_permission', true) = requested_permission
    );
$$;

create or replace function private.write_audit_log(
  target_organization_id uuid,
  target_event_type text,
  target_operation_code text default null,
  target_actor_employee_id uuid default null,
  target_subject_employee_id uuid default null,
  target_store_id uuid default null,
  target_register_id uuid default null,
  target_approval_request_id uuid default null,
  target_amount_minor bigint default null,
  target_reason text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (
    organization_id,
    event_type,
    operation_code,
    actor_employee_id,
    subject_employee_id,
    store_id,
    register_id,
    approval_request_id,
    amount_minor,
    reason,
    metadata
  )
  values (
    target_organization_id,
    target_event_type,
    target_operation_code,
    target_actor_employee_id,
    target_subject_employee_id,
    target_store_id,
    target_register_id,
    target_approval_request_id,
    target_amount_minor,
    nullif(trim(coalesce(target_reason, '')), ''),
    coalesce(target_metadata, '{}'::jsonb)
  );
end;
$$;

create or replace function private.approval_operation_permission(target_operation_code text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case target_operation_code
    when 'sales.refund' then 'sales.refund'
    when 'cash.pay_out' then 'cash.pay_out'
    when 'inventory.adjust' then 'inventory.manage'
    when 'discounts.apply' then 'discounts.apply'
    when 'prices.override' then 'prices.override'
    when 'cash_drawer.open' then 'cash_drawer.open'
    when 'shifts.force_close' then 'shifts.force_close'
    when 'payments.adjust' then 'payments.accept'
    when 'sales.void' then 'sales.create'
    else null
  end;
$$;

create or replace function private.resolve_approval_context(
  target_organization_id uuid,
  target_operation_code text,
  target_payload jsonb
)
returns table (
  store_id uuid,
  register_id uuid,
  amount_minor bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_sale_id uuid;
  target_shift_id uuid;
  target_item jsonb;
  target_sale_item_id uuid;
  target_quantity integer;
  target_unit_price_minor bigint;
  calculated_amount_minor bigint := 0;
begin
  if coalesce(jsonb_typeof(target_payload), '') <> 'object' then
    raise exception 'Approval details are invalid.' using errcode = '23514';
  end if;

  if target_operation_code = 'sales.refund' then
    begin
      target_sale_id := (target_payload ->> 'sale_id')::uuid;
    exception when others then
      raise exception 'A valid sale is required for a refund approval.' using errcode = '23514';
    end;

    select sale.store_id, sale.register_id
    into store_id, register_id
    from public.sales sale
    where sale.organization_id = target_organization_id
      and sale.id = target_sale_id
      and sale.status = 'completed';

    if store_id is null then
      raise exception 'The completed sale was not found.' using errcode = 'P0002';
    end if;

    if coalesce(jsonb_typeof(target_payload -> 'items'), '') <> 'array'
      or coalesce(jsonb_array_length(target_payload -> 'items'), 0) not between 1 and 100 then
      raise exception 'Select refund items before requesting approval.' using errcode = '23514';
    end if;

    for target_item in select value from jsonb_array_elements(target_payload -> 'items') loop
      begin
        target_sale_item_id := (target_item ->> 'sale_item_id')::uuid;
        target_quantity := (target_item ->> 'quantity')::integer;
      exception when others then
        raise exception 'Refund approval items are invalid.' using errcode = '23514';
      end;

      select sale_item.unit_price_minor
      into target_unit_price_minor
      from public.sale_items sale_item
      where sale_item.organization_id = target_organization_id
        and sale_item.sale_id = target_sale_id
        and sale_item.id = target_sale_item_id;

      if target_unit_price_minor is null or target_quantity not between 1 and 10000 then
        raise exception 'Refund approval items do not match the original sale.' using errcode = '23514';
      end if;

      calculated_amount_minor := calculated_amount_minor + target_unit_price_minor * target_quantity;
    end loop;

    amount_minor := calculated_amount_minor;
    return next;
    return;
  end if;

  if target_operation_code = 'cash.pay_out' then
    begin
      target_shift_id := (target_payload ->> 'shift_id')::uuid;
      amount_minor := (target_payload ->> 'amount_minor')::bigint;
    exception when others then
      raise exception 'Cash approval details are invalid.' using errcode = '23514';
    end;

    select shift.store_id, shift.register_id
    into store_id, register_id
    from public.shifts shift
    where shift.organization_id = target_organization_id
      and shift.id = target_shift_id
      and shift.status = 'open';

    if store_id is null or amount_minor <= 0 then
      raise exception 'The open shift or cash amount is invalid.' using errcode = '23514';
    end if;

    return next;
    return;
  end if;

  if target_operation_code = 'inventory.adjust' then
    begin
      store_id := (target_payload ->> 'store_id')::uuid;
    exception when others then
      raise exception 'Inventory approval details are invalid.' using errcode = '23514';
    end;

    if not exists (
      select 1
      from public.stores store
      where store.id = store_id
        and store.organization_id = target_organization_id
        and store.is_active
    ) then
      raise exception 'Select an active store for this inventory adjustment.' using errcode = '23514';
    end if;

    register_id := null;
    amount_minor := null;
    return next;
    return;
  end if;

  raise exception 'This approval operation is not available yet.' using errcode = '23514';
end;
$$;

create or replace function private.approval_decision(
  target_organization_id uuid,
  target_operation_code text,
  target_amount_minor bigint
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rule public.approval_rules%rowtype;
begin
  select * into rule
  from public.approval_rules
  where organization_id = target_organization_id
    and operation_code = target_operation_code
    and is_enabled;

  if rule.id is null then return 'ALLOWED'; end if;
  if rule.decision <> 'APPROVAL_REQUIRED' then return rule.decision; end if;
  if rule.amount_threshold_minor is not null
    and target_amount_minor is not null
    and target_amount_minor <= rule.amount_threshold_minor then
    return 'ALLOWED';
  end if;
  return 'APPROVAL_REQUIRED';
end;
$$;

create or replace function private.set_employee_pin(
  target_organization_id uuid,
  target_employee_id uuid,
  target_pin text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
begin
  actor_employee_id := private.current_employee_id(target_organization_id);
  if actor_employee_id is null then
    raise exception 'An active employee is required.' using errcode = '42501';
  end if;

  if actor_employee_id is distinct from target_employee_id
    and not private.has_permission(target_organization_id, 'employees.manage') then
    raise exception 'Employee-management permission is required to set another employee PIN.' using errcode = '42501';
  end if;

  if coalesce(target_pin, '') !~ '^[0-9]{6,12}$' then
    raise exception 'Use a 6 to 12 digit PIN.' using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.employees employee
    where employee.id = target_employee_id
      and employee.organization_id = target_organization_id
      and employee.status = 'active'
  ) then
    raise exception 'The employee is not active in this organization.' using errcode = '23514';
  end if;

  insert into private.employee_pin_credentials (
    employee_id,
    pin_hash,
    failed_attempts,
    failed_window_started_at,
    locked_until,
    updated_by_employee_id,
    updated_at
  )
  values (
    target_employee_id,
    extensions.crypt(target_pin, extensions.gen_salt('bf', 12)),
    0,
    null,
    null,
    actor_employee_id,
    now()
  )
  on conflict (employee_id) do update
  set
    pin_hash = excluded.pin_hash,
    failed_attempts = 0,
    failed_window_started_at = null,
    locked_until = null,
    updated_by_employee_id = excluded.updated_by_employee_id,
    updated_at = now();

  perform private.write_audit_log(
    target_organization_id,
    'EMPLOYEE_PIN_SET',
    null,
    actor_employee_id,
    target_employee_id,
    null,
    null,
    null,
    null,
    null,
    '{}'::jsonb
  );
end;
$$;

create or replace function private.request_manager_approval(
  target_organization_id uuid,
  target_operation_code text,
  target_reason text,
  target_payload jsonb
)
returns table (
  decision text,
  approval_request_id uuid,
  expires_at timestamptz,
  message text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  required_permission text;
  resolved_store_id uuid;
  resolved_register_id uuid;
  resolved_amount_minor bigint;
  resolved_decision text;
  existing_request public.approval_requests%rowtype;
  normalized_reason text;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;

  required_permission := private.approval_operation_permission(target_operation_code);
  if required_permission is null then
    raise exception 'This approval operation is not supported.' using errcode = '23514';
  end if;

  actor_employee_id := private.current_employee_id(target_organization_id);
  if actor_employee_id is null then
    raise exception 'An active employee is required.' using errcode = '42501';
  end if;

  if not private.has_permission(target_organization_id, 'approvals.request') then
    raise exception 'Approval-request permission is required.' using errcode = '42501';
  end if;

  normalized_reason := trim(coalesce(target_reason, ''));
  if char_length(normalized_reason) not between 2 and 500 then
    raise exception 'Provide a reason between 2 and 500 characters.' using errcode = '23514';
  end if;

  select context.store_id, context.register_id, context.amount_minor
  into resolved_store_id, resolved_register_id, resolved_amount_minor
  from private.resolve_approval_context(
    target_organization_id,
    target_operation_code,
    target_payload
  ) context;

  if not exists (
    select 1
    from public.employee_stores employee_store
    where employee_store.organization_id = target_organization_id
      and employee_store.employee_id = actor_employee_id
      and employee_store.store_id = resolved_store_id
  ) then
    raise exception 'You are not assigned to the store for this request.' using errcode = '42501';
  end if;

  resolved_decision := private.approval_decision(
    target_organization_id,
    target_operation_code,
    resolved_amount_minor
  );

  if resolved_decision = 'DENIED' and not (
    private.employee_has_permission(target_organization_id, actor_employee_id, 'approvals.bypass')
    and private.employee_has_permission(target_organization_id, actor_employee_id, required_permission)
  ) then
    return query select 'DENIED'::text, null::uuid, null::timestamptz, 'This operation is disabled by the organization approval rule.'::text;
    return;
  end if;

  if resolved_decision = 'ALLOWED'
    and private.employee_has_permission(target_organization_id, actor_employee_id, required_permission) then
    return query select 'ALLOWED'::text, null::uuid, null::timestamptz, 'This operation is allowed for your role.'::text;
    return;
  end if;

  select * into existing_request
  from public.approval_requests request
  where request.organization_id = target_organization_id
    and request.requested_by_employee_id = actor_employee_id
    and request.operation_code = target_operation_code
    and request.request_payload = target_payload
    and request.status = 'PENDING'
    and request.expires_at > now()
  order by request.requested_at desc
  limit 1
  for update;

  if existing_request.id is not null then
    return query select 'APPROVAL_REQUIRED'::text, existing_request.id, existing_request.expires_at, 'Manager approval is pending.'::text;
    return;
  end if;

  insert into public.approval_requests (
    organization_id,
    store_id,
    register_id,
    requested_by_employee_id,
    operation_code,
    requested_amount_minor,
    reason,
    request_payload
  )
  values (
    target_organization_id,
    resolved_store_id,
    resolved_register_id,
    actor_employee_id,
    target_operation_code,
    resolved_amount_minor,
    normalized_reason,
    target_payload
  )
  returning id, public.approval_requests.expires_at into approval_request_id, expires_at;

  perform private.write_audit_log(
    target_organization_id,
    'APPROVAL_REQUESTED',
    target_operation_code,
    actor_employee_id,
    null,
    resolved_store_id,
    resolved_register_id,
    approval_request_id,
    resolved_amount_minor,
    normalized_reason,
    jsonb_build_object('status', 'PENDING')
  );

  decision := 'APPROVAL_REQUIRED';
  message := 'Manager approval is required for this operation.';
  return next;
end;
$$;

create or replace function private.approve_manager_approval(
  target_organization_id uuid,
  target_approval_request_id uuid,
  target_approver_employee_number text,
  target_pin text
)
returns table (
  approval_request_id uuid,
  approved_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester_employee_id uuid;
  request public.approval_requests%rowtype;
  approver public.employees%rowtype;
  credential private.employee_pin_credentials%rowtype;
  required_permission text;
  next_failed_attempts integer;
begin
  requester_employee_id := private.current_employee_id(target_organization_id);
  if requester_employee_id is null then
    raise exception 'An active employee is required.' using errcode = '42501';
  end if;

  select * into request
  from public.approval_requests approval_request
  where approval_request.id = target_approval_request_id
    and approval_request.organization_id = target_organization_id
  for update;

  if request.id is null then
    raise exception 'The approval request was not found.' using errcode = 'P0002';
  end if;

  if request.requested_by_employee_id is distinct from requester_employee_id then
    raise exception 'Only the requesting employee can present this approval.' using errcode = '42501';
  end if;

  if request.status <> 'PENDING' or request.expires_at <= now() then
    if request.status = 'PENDING' then
      update public.approval_requests
      set status = 'EXPIRED', updated_at = now()
      where id = request.id and organization_id = request.organization_id;
    end if;
    raise exception 'This approval request is no longer pending.' using errcode = '23514';
  end if;

  select * into approver
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.employee_number = upper(trim(coalesce(target_approver_employee_number, '')))
    and employee.status = 'active'
  for key share;

  required_permission := private.approval_operation_permission(request.operation_code);
  if approver.id is null
    or approver.id = requester_employee_id
    or not private.employee_has_permission(target_organization_id, approver.id, 'approvals.authorize')
    or not private.employee_has_permission(target_organization_id, approver.id, required_permission)
    or not exists (
      select 1
      from public.employee_stores employee_store
      where employee_store.organization_id = target_organization_id
        and employee_store.employee_id = approver.id
        and employee_store.store_id = request.store_id
    ) then
    raise exception 'A qualified manager assigned to this store must approve the request.' using errcode = '42501';
  end if;

  select * into credential
  from private.employee_pin_credentials pin_credential
  where pin_credential.employee_id = approver.id
  for update;

  if credential.employee_id is null then
    raise exception 'Manager PIN approval is unavailable. Set a secure manager PIN first.' using errcode = '42501';
  end if;

  if credential.locked_until is not null and credential.locked_until > now() then
    raise exception 'This manager PIN is temporarily locked. Try again later.' using errcode = '42501';
  end if;

  if coalesce(target_pin, '') !~ '^[0-9]{6,12}$'
    or credential.pin_hash <> extensions.crypt(target_pin, credential.pin_hash) then
    next_failed_attempts := case
      when credential.failed_window_started_at is null
        or credential.failed_window_started_at < now() - interval '15 minutes' then 1
      else credential.failed_attempts + 1
    end;

    update private.employee_pin_credentials
    set
      failed_attempts = least(next_failed_attempts, 5),
      failed_window_started_at = case
        when credential.failed_window_started_at is null
          or credential.failed_window_started_at < now() - interval '15 minutes' then now()
        else credential.failed_window_started_at
      end,
      locked_until = case when next_failed_attempts >= 5 then now() + interval '15 minutes' else null end,
      updated_at = now()
    where employee_id = approver.id;

    if next_failed_attempts >= 5 then
      perform private.write_audit_log(
        target_organization_id,
        'MANAGER_PIN_LOCKED',
        request.operation_code,
        approver.id,
        approver.id,
        request.store_id,
        request.register_id,
        request.id,
        request.requested_amount_minor,
        null,
        jsonb_build_object('lock_minutes', 15)
      );
    end if;

    raise exception 'Manager PIN verification failed.' using errcode = '42501';
  end if;

  update private.employee_pin_credentials
  set failed_attempts = 0, failed_window_started_at = null, locked_until = null, updated_at = now()
  where employee_id = approver.id;

  update public.approval_requests
  set
    status = 'APPROVED',
    approved_by_employee_id = approver.id,
    decided_at = now(),
    updated_at = now()
  where id = request.id and organization_id = request.organization_id;

  perform private.write_audit_log(
    target_organization_id,
    'APPROVAL_APPROVED',
    request.operation_code,
    approver.id,
    requester_employee_id,
    request.store_id,
    request.register_id,
    request.id,
    request.requested_amount_minor,
    request.reason,
    jsonb_build_object('expires_at', request.expires_at)
  );

  return query select request.id, now();
end;
$$;

create or replace function private.activate_manager_approval(
  target_organization_id uuid,
  target_approval_request_id uuid,
  target_operation_code text,
  target_expected_payload jsonb,
  target_execution_idempotency_key uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  request public.approval_requests%rowtype;
  required_permission text;
begin
  actor_employee_id := private.current_employee_id(target_organization_id);
  if actor_employee_id is null then
    raise exception 'An active employee is required.' using errcode = '42501';
  end if;

  select * into request
  from public.approval_requests approval_request
  where approval_request.id = target_approval_request_id
    and approval_request.organization_id = target_organization_id
  for update;

  if request.id is null
    or request.requested_by_employee_id is distinct from actor_employee_id
    or request.operation_code is distinct from target_operation_code
    or request.request_payload is distinct from target_expected_payload then
    raise exception 'The manager approval does not match this operation.' using errcode = '42501';
  end if;

  required_permission := private.approval_operation_permission(target_operation_code);
  if required_permission is null then
    raise exception 'This approval operation is not supported.' using errcode = '23514';
  end if;

  if request.status = 'CONSUMED' then
    if target_execution_idempotency_key is null
      or request.execution_idempotency_key is distinct from target_execution_idempotency_key then
      raise exception 'This manager approval was already used.' using errcode = '23514';
    end if;
  elsif request.status = 'APPROVED' and request.expires_at > now() then
    update public.approval_requests
    set
      status = 'CONSUMED',
      consumed_at = now(),
      execution_idempotency_key = target_execution_idempotency_key,
      updated_at = now()
    where id = request.id and organization_id = request.organization_id;

    perform private.write_audit_log(
      target_organization_id,
      'APPROVAL_CONSUMED',
      target_operation_code,
      actor_employee_id,
      request.approved_by_employee_id,
      request.store_id,
      request.register_id,
      request.id,
      request.requested_amount_minor,
      request.reason,
      '{}'::jsonb
    );
  else
    raise exception 'The manager approval is no longer valid.' using errcode = '42501';
  end if;

  perform set_config('tindio.approval_profile_id', (select auth.uid())::text, true);
  perform set_config('tindio.approval_organization_id', target_organization_id::text, true);
  perform set_config('tindio.approval_permission', required_permission, true);
end;
$$;

create or replace function private.authorize_sensitive_operation(
  target_organization_id uuid,
  target_operation_code text,
  target_approval_request_id uuid,
  target_expected_payload jsonb,
  target_execution_idempotency_key uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  required_permission text;
  decision text;
  context record;
begin
  actor_employee_id := private.current_employee_id(target_organization_id);
  required_permission := private.approval_operation_permission(target_operation_code);
  if actor_employee_id is null or required_permission is null then
    raise exception 'You are not authorized for this operation.' using errcode = '42501';
  end if;

  select * into context
  from private.resolve_approval_context(target_organization_id, target_operation_code, target_expected_payload);
  decision := private.approval_decision(target_organization_id, target_operation_code, context.amount_minor);

  if decision = 'DENIED'
    and not (
      private.employee_has_permission(target_organization_id, actor_employee_id, 'approvals.bypass')
      and private.employee_has_permission(target_organization_id, actor_employee_id, required_permission)
    ) then
    raise exception 'This operation is disabled by the organization approval rule.' using errcode = '42501';
  end if;

  if decision = 'APPROVAL_REQUIRED'
    and not (
      private.employee_has_permission(target_organization_id, actor_employee_id, 'approvals.bypass')
      and private.employee_has_permission(target_organization_id, actor_employee_id, required_permission)
    ) then
    if target_approval_request_id is null then
      raise exception 'Manager approval is required for this operation.' using errcode = '42501';
    end if;
    perform private.activate_manager_approval(
      target_organization_id,
      target_approval_request_id,
      target_operation_code,
      target_expected_payload,
      target_execution_idempotency_key
    );
    return;
  end if;

  if target_approval_request_id is not null then
    perform private.activate_manager_approval(
      target_organization_id,
      target_approval_request_id,
      target_operation_code,
      target_expected_payload,
      target_execution_idempotency_key
    );
    return;
  end if;

  if not private.employee_has_permission(target_organization_id, actor_employee_id, required_permission) then
    raise exception 'Manager approval is required for this operation.' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.update_approval_rule(
  target_organization_id uuid,
  target_operation_code text,
  target_decision text,
  target_amount_threshold_minor bigint,
  target_is_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
begin
  actor_employee_id := private.current_employee_id(target_organization_id);
  if actor_employee_id is null
    or not private.has_permission(target_organization_id, 'approvals.manage') then
    raise exception 'Approval-rule management permission is required.' using errcode = '42501';
  end if;

  if private.approval_operation_permission(target_operation_code) is null
    or target_decision not in ('ALLOWED', 'DENIED', 'APPROVAL_REQUIRED')
    or (target_amount_threshold_minor is not null and target_amount_threshold_minor < 0) then
    raise exception 'Approval-rule details are invalid.' using errcode = '23514';
  end if;

  insert into public.approval_rules (
    organization_id,
    operation_code,
    decision,
    amount_threshold_minor,
    is_enabled
  )
  values (
    target_organization_id,
    target_operation_code,
    target_decision,
    target_amount_threshold_minor,
    coalesce(target_is_enabled, true)
  )
  on conflict (organization_id, operation_code) do update
  set
    decision = excluded.decision,
    amount_threshold_minor = excluded.amount_threshold_minor,
    is_enabled = excluded.is_enabled,
    updated_at = now();

  perform private.write_audit_log(
    target_organization_id,
    'APPROVAL_RULE_UPDATED',
    target_operation_code,
    actor_employee_id,
    null,
    null,
    null,
    null,
    target_amount_threshold_minor,
    null,
    jsonb_build_object('decision', target_decision, 'is_enabled', coalesce(target_is_enabled, true))
  );
end;
$$;

insert into public.approval_rules (organization_id, operation_code, decision, amount_threshold_minor)
select organization.id, operation.operation_code, operation.decision, operation.amount_threshold_minor
from public.organizations organization
cross join (
  values
    ('sales.refund'::text, 'ALLOWED'::text, null::bigint),
    ('cash.pay_out'::text, 'APPROVAL_REQUIRED'::text, 500000::bigint),
    ('inventory.adjust'::text, 'ALLOWED'::text, null::bigint),
    ('discounts.apply'::text, 'ALLOWED'::text, null::bigint),
    ('prices.override'::text, 'APPROVAL_REQUIRED'::text, null::bigint),
    ('cash_drawer.open'::text, 'APPROVAL_REQUIRED'::text, null::bigint),
    ('shifts.force_close'::text, 'APPROVAL_REQUIRED'::text, null::bigint),
    ('payments.adjust'::text, 'APPROVAL_REQUIRED'::text, null::bigint),
    ('sales.void'::text, 'APPROVAL_REQUIRED'::text, null::bigint)
) as operation(operation_code, decision, amount_threshold_minor)
on conflict (organization_id, operation_code) do nothing;

create policy approval_rules_select_member
on public.approval_rules for select
to authenticated
using ((select private.is_organization_member(organization_id)));

create policy approval_requests_select_requester_or_approver
on public.approval_requests for select
to authenticated
using (
  requested_by_employee_id = (select private.current_employee_id(organization_id))
  or (select private.has_permission(organization_id, 'approvals.authorize'))
  or (select private.has_permission(organization_id, 'approvals.manage'))
);

create policy audit_logs_select_authorized
on public.audit_logs for select
to authenticated
using ((select private.has_permission(organization_id, 'audit.view')));

grant select on public.approval_rules, public.approval_requests, public.audit_logs to authenticated;
revoke all on private.employee_pin_credentials from public, anon, authenticated, service_role;

revoke execute on function private.current_employee_id(uuid), private.employee_has_permission(uuid, uuid, text), private.write_audit_log(uuid, text, text, uuid, uuid, uuid, uuid, uuid, bigint, text, jsonb), private.approval_operation_permission(text), private.resolve_approval_context(uuid, text, jsonb), private.approval_decision(uuid, text, bigint), private.set_employee_pin(uuid, uuid, text), private.request_manager_approval(uuid, text, text, jsonb), private.approve_manager_approval(uuid, uuid, text, text), private.activate_manager_approval(uuid, uuid, text, jsonb, uuid), private.authorize_sensitive_operation(uuid, text, uuid, jsonb, uuid), private.update_approval_rule(uuid, text, text, bigint, boolean)
from public, anon, authenticated, service_role;

grant execute on function private.current_employee_id(uuid), private.employee_has_permission(uuid, uuid, text), private.set_employee_pin(uuid, uuid, text), private.request_manager_approval(uuid, text, text, jsonb), private.approve_manager_approval(uuid, uuid, text, text), private.authorize_sensitive_operation(uuid, text, uuid, jsonb, uuid), private.update_approval_rule(uuid, text, text, bigint, boolean) to authenticated;

create or replace function public.set_employee_pin(
  target_organization_id uuid,
  target_employee_id uuid,
  target_pin text
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.set_employee_pin(target_organization_id, target_employee_id, target_pin);
$$;

create or replace function public.request_manager_approval(
  target_organization_id uuid,
  target_operation_code text,
  target_reason text,
  target_payload jsonb
)
returns table (
  decision text,
  approval_request_id uuid,
  expires_at timestamptz,
  message text
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.request_manager_approval(
    target_organization_id,
    target_operation_code,
    target_reason,
    target_payload
  );
$$;

create or replace function public.approve_manager_approval(
  target_organization_id uuid,
  target_approval_request_id uuid,
  target_approver_employee_number text,
  target_pin text
)
returns table (
  approval_request_id uuid,
  approved_at timestamptz
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.approve_manager_approval(
    target_organization_id,
    target_approval_request_id,
    target_approver_employee_number,
    target_pin
  );
$$;

create or replace function public.update_approval_rule(
  target_organization_id uuid,
  target_operation_code text,
  target_decision text,
  target_amount_threshold_minor bigint,
  target_is_enabled boolean
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.update_approval_rule(
    target_organization_id,
    target_operation_code,
    target_decision,
    target_amount_threshold_minor,
    target_is_enabled
  );
$$;

-- Existing public RPCs retain their names and original arguments. The optional
-- approval argument makes a manager authorization part of the same database
-- transaction as the protected operation.
drop function public.refund_sale(uuid, uuid, uuid, uuid, text, text, jsonb);
create function public.refund_sale(
  target_organization_id uuid,
  target_sale_id uuid,
  target_payment_method_id uuid,
  target_idempotency_key uuid,
  target_reason text,
  target_reference_number text,
  target_items jsonb,
  target_approval_request_id uuid default null
)
returns table (
  refund_id uuid,
  refund_number bigint,
  total_minor bigint,
  was_replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expected_payload jsonb;
begin
  expected_payload := jsonb_build_object(
    'items', target_items,
    'payment_method_id', target_payment_method_id,
    'reason', trim(coalesce(target_reason, '')),
    'reference_number', nullif(trim(coalesce(target_reference_number, '')), ''),
    'sale_id', target_sale_id
  );

  perform private.authorize_sensitive_operation(
    target_organization_id,
    'sales.refund',
    target_approval_request_id,
    expected_payload,
    target_idempotency_key
  );

  return query
  select * from private.refund_sale(
    target_organization_id,
    target_sale_id,
    target_payment_method_id,
    target_idempotency_key,
    target_reason,
    target_reference_number,
    target_items
  );
end;
$$;

drop function public.record_cash_movement(uuid, uuid, text, bigint, text, uuid);
create function public.record_cash_movement(
  target_organization_id uuid,
  target_shift_id uuid,
  target_movement_type text,
  target_amount_minor bigint,
  target_reason text,
  target_idempotency_key uuid,
  target_approval_request_id uuid default null
)
returns table (
  cash_movement_id uuid,
  created_at timestamptz,
  was_replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expected_payload jsonb;
begin
  expected_payload := jsonb_build_object(
    'shift_id', target_shift_id,
    'movement_type', target_movement_type,
    'amount_minor', target_amount_minor,
    'reason', trim(coalesce(target_reason, ''))
  );

  if target_movement_type = 'PAY_OUT' then
    perform private.authorize_sensitive_operation(
      target_organization_id,
      'cash.pay_out',
      target_approval_request_id,
      expected_payload,
      target_idempotency_key
    );
  end if;

  return query
  select * from private.record_cash_movement(
    target_organization_id,
    target_shift_id,
    target_movement_type,
    target_amount_minor,
    target_reason,
    target_idempotency_key
  );
end;
$$;

drop function public.adjust_inventory(uuid, uuid, uuid, uuid, numeric, text, text);
create function public.adjust_inventory(
  target_organization_id uuid,
  target_store_id uuid,
  target_product_id uuid,
  target_variant_id uuid,
  target_quantity_delta numeric,
  target_movement_type text,
  target_reason text,
  target_approval_request_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expected_payload jsonb;
begin
  expected_payload := jsonb_build_object(
    'store_id', target_store_id,
    'product_id', target_product_id,
    'variant_id', target_variant_id,
    'quantity_delta', target_quantity_delta,
    'movement_type', target_movement_type,
    'reason', trim(coalesce(target_reason, ''))
  );

  perform private.authorize_sensitive_operation(
    target_organization_id,
    'inventory.adjust',
    target_approval_request_id,
    expected_payload,
    null
  );

  return private.adjust_inventory(
    target_organization_id,
    target_store_id,
    target_product_id,
    target_variant_id,
    target_quantity_delta,
    target_movement_type,
    target_reason
  );
end;
$$;

revoke execute on function public.set_employee_pin(uuid, uuid, text), public.request_manager_approval(uuid, text, text, jsonb), public.approve_manager_approval(uuid, uuid, text, text), public.update_approval_rule(uuid, text, text, bigint, boolean), public.refund_sale(uuid, uuid, uuid, uuid, text, text, jsonb, uuid), public.record_cash_movement(uuid, uuid, text, bigint, text, uuid, uuid), public.adjust_inventory(uuid, uuid, uuid, uuid, numeric, text, text, uuid)
from public, anon, service_role;
grant execute on function public.set_employee_pin(uuid, uuid, text), public.request_manager_approval(uuid, text, text, jsonb), public.approve_manager_approval(uuid, uuid, text, text), public.update_approval_rule(uuid, text, text, bigint, boolean), public.refund_sale(uuid, uuid, uuid, uuid, text, text, jsonb, uuid), public.record_cash_movement(uuid, uuid, text, bigint, text, uuid, uuid), public.adjust_inventory(uuid, uuid, uuid, uuid, numeric, text, text, uuid)
to authenticated;

create or replace function private.audit_cash_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.write_audit_log(
    new.organization_id,
    'CASH_MOVEMENT_RECORDED',
    case when new.movement_type = 'PAY_OUT' then 'cash.pay_out' else 'cash.pay_in' end,
    new.employee_id,
    null,
    new.store_id,
    new.register_id,
    null,
    new.amount_minor,
    new.reason,
    jsonb_build_object('cash_movement_id', new.id, 'shift_id', new.shift_id, 'movement_type', new.movement_type)
  );
  return new;
end;
$$;

create or replace function private.audit_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.movement_type in ('OPENING_STOCK', 'ADJUSTMENT') then
    perform private.write_audit_log(
      new.organization_id,
      'INVENTORY_MOVEMENT_RECORDED',
      'inventory.adjust',
      new.actor_employee_id,
      null,
      new.store_id,
      null,
      null,
      null,
      new.reason,
      jsonb_build_object('inventory_movement_id', new.id, 'product_id', new.product_id, 'variant_id', new.variant_id, 'quantity_delta', new.quantity_delta, 'movement_type', new.movement_type)
    );
  end if;
  return new;
end;
$$;

create or replace function private.audit_refund_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.total_minor is distinct from new.total_minor and new.status = 'completed' then
    perform private.write_audit_log(
      new.organization_id,
      'REFUND_COMPLETED',
      'sales.refund',
      new.refunded_by_employee_id,
      null,
      new.store_id,
      new.register_id,
      null,
      new.total_minor,
      new.reason,
      jsonb_build_object('refund_id', new.id, 'sale_id', new.sale_id, 'refund_number', new.refund_number)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists cash_movements_audit_log on public.cash_movements;
create trigger cash_movements_audit_log
after insert on public.cash_movements
for each row execute function private.audit_cash_movement();

drop trigger if exists inventory_movements_audit_log on public.inventory_movements;
create trigger inventory_movements_audit_log
after insert on public.inventory_movements
for each row execute function private.audit_inventory_movement();

drop trigger if exists refunds_audit_log on public.refunds;
create trigger refunds_audit_log
after update of total_minor on public.refunds
for each row execute function private.audit_refund_completion();

revoke execute on function private.audit_cash_movement(), private.audit_inventory_movement(), private.audit_refund_completion() from public, anon, authenticated, service_role;

commit;
