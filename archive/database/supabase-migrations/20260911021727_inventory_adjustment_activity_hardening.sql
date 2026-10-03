-- Phase 9: harden controlled adjustments and activity access without creating
-- a parallel stock command or ledger.  Phase 6 installs the granular
-- inventory-capability resolver used here; the legacy capability mappings
-- remain in that resolver for customer-defined roles created before it.
begin;

-- Approval rules stay attached to the existing `inventory.adjust` operation
-- code, so historical rules and audit records remain valid.  The permission
-- required to perform/approve that operation is now the post capability.
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
    when 'inventory.adjust' then 'inventory.adjust.post'
    when 'discounts.apply' then 'discounts.apply'
    when 'prices.override' then 'prices.override'
    when 'cash_drawer.open' then 'cash_drawer.open'
    when 'shifts.force_close' then 'shifts.force_close'
    when 'payments.adjust' then 'payments.accept'
    when 'sales.void' then 'sales.create'
    else null
  end;
$$;

-- Keep manager-approval requests from becoming an alternate authorization
-- route.  A requester needs approval-request permission plus adjustment
-- preparation or posting capability; final posting remains governed by the
-- existing approval activation and the post capability above.
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

  if target_operation_code = 'inventory.adjust'
    and not private.has_any_inventory_capability(
      target_organization_id,
      array['inventory.adjust.create', 'inventory.adjust.post']
    ) then
    raise exception 'Inventory adjustment permission is required.' using errcode = '42501';
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

  if not private.has_store_read_scope(target_organization_id, resolved_store_id) then
    raise exception 'You do not have access to the store for this request.' using errcode = '42501';
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

-- Inventory commands retain the current active employee as their actor, but
-- use the same store-scope resolver as RLS. This keeps assignment-scoped
-- operators constrained while allowing a capability-defined organization-wide
-- authority (for example, a role with stores.manage) to operate across stores
-- without a duplicate employee-store row.
create or replace function private.inventory_actor(
  target_organization_id uuid,
  target_store_id uuid
)
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
    and (select private.has_store_read_scope(target_organization_id, target_store_id))
  order by employee.created_at
  limit 1;
$$;

-- Activity and adjustment-document reads use the same capability + store
-- scope model as the Back Office.  These are read policies only; all stock
-- changes continue through the existing security-definer adjustment RPC.
drop policy if exists inventory_adjustment_import_batches_select_authorized_scope
  on public.inventory_adjustment_import_batches;
create policy inventory_adjustment_import_batches_select_authorized_scope
on public.inventory_adjustment_import_batches for select to authenticated
using (
  (
    (select private.has_permission(organization_id, 'inventory.view'))
    or (select private.has_any_inventory_capability(
      organization_id,
      array['inventory.adjust.create', 'inventory.adjust.post']
    ))
  )
  and (select private.has_store_read_scope(organization_id, store_id))
);

drop policy if exists inventory_adjustments_select_authorized_scope
  on public.inventory_adjustments;
create policy inventory_adjustments_select_authorized_scope
on public.inventory_adjustments for select to authenticated
using (
  (
    (select private.has_permission(organization_id, 'inventory.view'))
    or (select private.has_any_inventory_capability(
      organization_id,
      array['inventory.adjust.create', 'inventory.adjust.post']
    ))
  )
  and (select private.has_store_read_scope(organization_id, store_id))
);

drop policy if exists inventory_adjustment_reasons_select_adjuster
  on public.inventory_adjustment_reasons;
create policy inventory_adjustment_reasons_select_adjuster
on public.inventory_adjustment_reasons for select to authenticated
using (
  (select private.has_any_inventory_capability(
    organization_id,
    array['inventory.adjust.create', 'inventory.adjust.post']
  ))
);

drop policy if exists inventory_movements_select_authorized on public.inventory_movements;
create policy inventory_movements_select_authorized
on public.inventory_movements for select to authenticated
using (
  (
    (select private.has_permission(organization_id, 'inventory.view'))
    or (select private.has_any_inventory_capability(
      organization_id,
      array[
        'inventory.adjust.create',
        'inventory.adjust.post',
        'inventory.count.create',
        'inventory.count.finalize'
      ]
    ))
  )
  and (select private.has_store_read_scope(organization_id, store_id))
);

comment on function private.approval_operation_permission(text) is
  'Maps sensitive approval operations to their required permission. Inventory adjustments require inventory.adjust.post; approval requests additionally require adjustment create or post capability.';

commit;
