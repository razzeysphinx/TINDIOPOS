-- TINDIO Improvement 1: keep approval defaults consistent for organizations
-- created after the approval engine was introduced.

begin;

create or replace function private.seed_organization_approval_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.approval_rules (
    organization_id,
    operation_code,
    decision,
    amount_threshold_minor
  )
  values
    (new.id, 'sales.refund', 'ALLOWED', null),
    (new.id, 'cash.pay_out', 'APPROVAL_REQUIRED', 500000),
    (new.id, 'inventory.adjust', 'ALLOWED', null),
    (new.id, 'discounts.apply', 'ALLOWED', null),
    (new.id, 'prices.override', 'APPROVAL_REQUIRED', null),
    (new.id, 'cash_drawer.open', 'APPROVAL_REQUIRED', null),
    (new.id, 'shifts.force_close', 'APPROVAL_REQUIRED', null),
    (new.id, 'payments.adjust', 'APPROVAL_REQUIRED', null),
    (new.id, 'sales.void', 'APPROVAL_REQUIRED', null)
  on conflict (organization_id, operation_code) do nothing;

  return new;
end;
$$;

revoke execute on function private.seed_organization_approval_rules()
from public, anon, authenticated, service_role;

drop trigger if exists organizations_seed_approval_rules on public.organizations;
create trigger organizations_seed_approval_rules
after insert on public.organizations
for each row execute function private.seed_organization_approval_rules();

-- The original bootstrap function inserts starter-role permissions with plain
-- inserts. Update its three limited role lists (owner/admin already receive
-- the whole permission catalogue) so future organizations receive the same
-- granular access as organizations that existed during Improvement 1.
do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.bootstrap_organization(text,text,text,text,text)'::regprocedure
  ) into function_definition;

  if position('''kitchen.view'', ''kitchen.manage''' in function_definition) = 0
    or position('''cash.pay_in'', ''cash.pay_out''' in function_definition) = 0
    or position(
      '''products.manage'', ''products.view_cost'', ''inventory.manage'''
      in function_definition
    ) = 0 then
    raise exception 'Unexpected bootstrap_organization definition; aborting safe approval permission update.';
  end if;

  function_definition := replace(
    function_definition,
    '''kitchen.view'', ''kitchen.manage''',
    '''kitchen.view'', ''kitchen.manage'', ''pos.access'', ''pos.edit_quantity'', ''pos.remove_item'', ''payments.accept'', ''tickets.manage'', ''cash_drawer.open'', ''shifts.view_expected_cash'', ''shifts.view_history'', ''shifts.force_close'', ''inventory.view'', ''inventory.adjust'', ''inventory.count'', ''inventory.receive'', ''inventory.purchase_orders'', ''inventory.transfers'', ''inventory.suppliers'', ''approvals.request'', ''approvals.authorize'', ''audit.view'''
  );
  function_definition := replace(
    function_definition,
    '''cash.pay_in'', ''cash.pay_out''',
    '''cash.pay_in'', ''cash.pay_out'', ''pos.access'', ''pos.edit_quantity'', ''pos.remove_item'', ''payments.accept'', ''approvals.request'''
  );
  function_definition := replace(
    function_definition,
    '''products.manage'', ''products.view_cost'', ''inventory.manage''',
    '''products.manage'', ''products.view_cost'', ''inventory.manage'', ''inventory.view'', ''inventory.adjust'', ''inventory.count'', ''inventory.receive'', ''inventory.purchase_orders'', ''inventory.transfers'', ''inventory.suppliers'', ''approvals.request'''
  );

  execute function_definition;
end;
$$;

-- Idempotently protect any organization created between the initial migration
-- and this trigger being installed.
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

commit;
