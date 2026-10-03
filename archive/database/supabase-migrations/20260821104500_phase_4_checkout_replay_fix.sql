-- Preserve the already-applied checkout implementation while correcting its
-- replay result cast. This wrapper handles an existing idempotency request
-- before delegating a first-time request to the original transaction routine.

begin;

alter function private.checkout_sale(uuid, uuid, uuid, uuid, jsonb, jsonb)
rename to checkout_sale_v1;

create or replace function private.checkout_sale(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid,
  target_idempotency_key uuid,
  target_items jsonb,
  target_payments jsonb
)
returns table (
  sale_id uuid,
  receipt_number bigint,
  total_minor bigint,
  change_minor bigint,
  payment_summary jsonb,
  was_replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  existing_actor_employee_id uuid;
  existing_payload jsonb;
  existing_sale_id uuid;
  existing_payment_summary jsonb;
  canonical_payload jsonb;
begin
  if target_organization_id is null
    or target_store_id is null
    or target_register_id is null
    or target_idempotency_key is null then
    raise exception 'A store, register, and checkout key are required.'
      using errcode = '23514';
  end if;

  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'Sales permission is required.' using errcode = '42501';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  join public.employee_stores employee_store
    on employee_store.employee_id = employee.id
   and employee_store.organization_id = employee.organization_id
   and employee_store.store_id = target_store_id
  join public.stores store
    on store.id = target_store_id
   and store.organization_id = employee.organization_id
   and store.is_active
  join public.registers register
    on register.id = target_register_id
   and register.store_id = store.id
   and register.organization_id = store.organization_id
   and register.is_active
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active';

  if actor_employee_id is null then
    raise exception 'An active assigned employee and register are required.'
      using errcode = '42501';
  end if;

  canonical_payload := jsonb_build_object(
    'items', target_items,
    'payments', target_payments,
    'register_id', target_register_id,
    'store_id', target_store_id
  );

  select
    request.actor_employee_id,
    request.request_payload,
    request.sale_id
  into
    existing_actor_employee_id,
    existing_payload,
    existing_sale_id
  from public.checkout_requests request
  where request.organization_id = target_organization_id
    and request.idempotency_key = target_idempotency_key
  for update;

  if found then
    if existing_actor_employee_id is distinct from actor_employee_id
      or existing_payload is distinct from canonical_payload then
      raise exception 'This checkout key was already used for a different request.'
        using errcode = '23505';
    end if;

    if existing_sale_id is null then
      raise exception 'The prior checkout request did not complete. Try again with a new checkout key.'
        using errcode = '40001';
    end if;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'payment_method_id', payment.payment_method_id,
          'name', payment.payment_method_name_snapshot,
          'code', payment.payment_method_code_snapshot,
          'type', payment.payment_method_type_snapshot,
          'amount_minor', payment.amount_minor,
          'amount_tendered_minor', payment.amount_tendered_minor,
          'change_given_minor', payment.change_given_minor,
          'reference_number', payment.reference_number,
          'note', payment.note
        ) order by payment.created_at, payment.id
      ),
      '[]'::jsonb
    )
    into existing_payment_summary
    from public.payments payment
    where payment.sale_id = existing_sale_id
      and payment.organization_id = target_organization_id;

    return query
    select
      completed_sale.id,
      receipt.receipt_number,
      completed_sale.total_minor,
      coalesce((
        select sum(payment.change_given_minor)
        from public.payments payment
        where payment.sale_id = completed_sale.id
          and payment.organization_id = completed_sale.organization_id
      ), 0)::bigint,
      existing_payment_summary,
      true
    from public.sales completed_sale
    join public.receipts receipt
      on receipt.sale_id = completed_sale.id
     and receipt.organization_id = completed_sale.organization_id
    where completed_sale.id = existing_sale_id
      and completed_sale.organization_id = target_organization_id;
    return;
  end if;

  return query
  select *
  from private.checkout_sale_v1(
    target_organization_id,
    target_store_id,
    target_register_id,
    target_idempotency_key,
    target_items,
    target_payments
  );
end;
$$;

revoke execute on function private.checkout_sale_v1(uuid, uuid, uuid, uuid, jsonb, jsonb)
from public, anon, authenticated, service_role;

revoke execute on function private.checkout_sale(uuid, uuid, uuid, uuid, jsonb, jsonb)
from public, anon, authenticated, service_role;

grant execute on function private.checkout_sale(uuid, uuid, uuid, uuid, jsonb, jsonb)
to authenticated;

comment on function private.checkout_sale_v1(uuid, uuid, uuid, uuid, jsonb, jsonb)
is 'Internal Phase 4 transaction implementation retained for migration compatibility. Calls are routed through private.checkout_sale.';

comment on function private.checkout_sale(uuid, uuid, uuid, uuid, jsonb, jsonb)
is 'Idempotent checkout boundary. It returns completed requests safely and delegates first-time transactions to the Phase 4 implementation.';

commit;
