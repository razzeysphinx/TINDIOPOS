-- Final cashier receipts workspace: compact payment summaries, forgiving
-- receipt lookup, complete receipt snapshots, and two-path refund approvals.

begin;

drop function public.get_pos_receipt_history(uuid, text, bigint, integer);

create function public.get_pos_receipt_history(
  target_organization_id uuid,
  target_query text default null,
  target_before_receipt_number bigint default null,
  target_limit integer default 25
)
returns table (
  receipt_id uuid,
  sale_id uuid,
  receipt_number bigint,
  issued_at timestamptz,
  store_id uuid,
  register_id uuid,
  store_name text,
  register_name text,
  cashier_name text,
  total_minor bigint,
  currency_code text,
  refund_total_minor bigint,
  refund_count bigint,
  has_refundable_quantity boolean,
  payment_methods jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  normalized_query text := nullif(btrim(target_query), '');
  normalized_receipt_query text;
  receipt_query_is_numeric boolean := false;
  can_access_store_receipts boolean := false;
begin
  if target_organization_id is null
    or target_limit is null
    or target_limit not between 1 and 50
    or (target_before_receipt_number is not null and target_before_receipt_number < 1)
    or (normalized_query is not null and char_length(normalized_query) > 100) then
    raise exception 'The POS receipt request is invalid.' using errcode = '23514';
  end if;

  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create'))
    or not (select private.has_permission(target_organization_id, 'receipts.view')) then
    raise exception 'Receipt permission is required to view POS receipts.' using errcode = '42501';
  end if;

  actor_employee_id := private.current_employee_id(target_organization_id);
  if actor_employee_id is null then
    raise exception 'An active employee is required to view POS receipts.' using errcode = '42501';
  end if;

  can_access_store_receipts :=
    (select private.has_permission(target_organization_id, 'sales.refund'))
    or (select private.has_permission(target_organization_id, 'approvals.authorize'));

  if normalized_query ~ '^#?[0-9]+$' then
    receipt_query_is_numeric := true;
    normalized_receipt_query := ltrim(regexp_replace(normalized_query, '^#', ''), '0');
    if normalized_receipt_query = '' then normalized_receipt_query := '0'; end if;
  end if;

  return query
  select
    receipt.id,
    sale.id,
    receipt.receipt_number,
    receipt.issued_at,
    sale.store_id,
    sale.register_id,
    sale.store_name_snapshot,
    sale.register_name_snapshot,
    sale.cashier_name_snapshot,
    sale.total_minor,
    sale.currency_code,
    refund_summary.total_minor,
    refund_summary.refund_count,
    quantity_summary.has_refundable_quantity,
    payment_summary.methods
  from public.receipts receipt
  join public.sales sale
    on sale.id = receipt.sale_id
   and sale.organization_id = receipt.organization_id
  left join lateral (
    select
      coalesce(sum(refund.total_minor), 0)::bigint as total_minor,
      count(refund.id)::bigint as refund_count
    from public.refunds refund
    where refund.organization_id = target_organization_id
      and refund.sale_id = sale.id
      and refund.status = 'completed'
  ) refund_summary on true
  left join lateral (
    select coalesce(bool_or(
      sale_item.quantity > coalesce(refund_quantity.total_quantity, 0)
    ), false) as has_refundable_quantity
    from public.sale_items sale_item
    left join lateral (
      select coalesce(sum(refund_item.quantity), 0)::integer as total_quantity
      from public.refund_items refund_item
      join public.refunds refund
        on refund.id = refund_item.refund_id
       and refund.organization_id = refund_item.organization_id
       and refund.status = 'completed'
      where refund_item.organization_id = target_organization_id
        and refund.sale_id = sale.id
        and refund_item.sale_item_id = sale_item.id
    ) refund_quantity on true
    where sale_item.organization_id = target_organization_id
      and sale_item.sale_id = sale.id
  ) quantity_summary on true
  left join lateral (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', payment.payment_method_name_snapshot,
      'type', payment.payment_method_type_snapshot
    ) order by payment.created_at), '[]'::jsonb) as methods
    from public.payments payment
    where payment.organization_id = target_organization_id
      and payment.sale_id = sale.id
  ) payment_summary on true
  where receipt.organization_id = target_organization_id
    and exists (
      select 1
      from public.employee_stores employee_store
      where employee_store.organization_id = target_organization_id
        and employee_store.employee_id = actor_employee_id
        and employee_store.store_id = sale.store_id
    )
    and (sale.cashier_employee_id = actor_employee_id or can_access_store_receipts)
    and (target_before_receipt_number is null or receipt.receipt_number < target_before_receipt_number)
    and (
      normalized_query is null
      or (
        receipt_query_is_numeric
        and ltrim(receipt.receipt_number::text, '0') = normalized_receipt_query
      )
      or (
        not receipt_query_is_numeric
        and (
          sale.store_name_snapshot ilike '%' || normalized_query || '%'
          or sale.register_name_snapshot ilike '%' || normalized_query || '%'
          or sale.cashier_name_snapshot ilike '%' || normalized_query || '%'
        )
      )
    )
  -- Receipt number is the cursor, so it must remain the leading sort key.
  order by receipt.receipt_number desc, receipt.issued_at desc
  limit target_limit;
end;
$$;

revoke all on function public.get_pos_receipt_history(uuid, text, bigint, integer)
  from public, anon, service_role;
grant execute on function public.get_pos_receipt_history(uuid, text, bigint, integer)
  to authenticated;

comment on function public.get_pos_receipt_history(uuid, text, bigint, integer) is
  'Cashier-safe receipt history with compact payment snapshots, assigned-store scope, normalized human receipt search, and quantity-based refund status.';

create or replace function public.get_pos_receipt_detail(
  target_organization_id uuid,
  target_receipt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  can_access_store_receipts boolean := false;
  receipt_record record;
begin
  if target_organization_id is null or target_receipt_id is null then
    raise exception 'The POS receipt request is invalid.' using errcode = '23514';
  end if;

  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create'))
    or not (select private.has_permission(target_organization_id, 'receipts.view')) then
    raise exception 'Receipt permission is required to view POS receipts.' using errcode = '42501';
  end if;

  actor_employee_id := private.current_employee_id(target_organization_id);
  if actor_employee_id is null then
    raise exception 'An active employee is required to view POS receipts.' using errcode = '42501';
  end if;

  can_access_store_receipts :=
    (select private.has_permission(target_organization_id, 'sales.refund'))
    or (select private.has_permission(target_organization_id, 'approvals.authorize'));

  select
    receipt.id as receipt_id,
    receipt.receipt_number,
    receipt.issued_at,
    receipt.receipt_layout_snapshot,
    sale.id as sale_id,
    sale.store_id,
    sale.register_id,
    sale.cashier_employee_id,
    sale.customer_id,
    sale.currency_code,
    sale.organization_name_snapshot,
    sale.store_name_snapshot,
    sale.register_name_snapshot,
    sale.cashier_name_snapshot,
    sale.subtotal_minor,
    sale.discount_minor,
    sale.tax_minor,
    sale.total_minor
  into receipt_record
  from public.receipts receipt
  join public.sales sale
    on sale.id = receipt.sale_id
   and sale.organization_id = receipt.organization_id
  where receipt.id = target_receipt_id
    and receipt.organization_id = target_organization_id;

  if receipt_record.receipt_id is null then return null; end if;

  if not exists (
    select 1 from public.employee_stores employee_store
    where employee_store.organization_id = target_organization_id
      and employee_store.employee_id = actor_employee_id
      and employee_store.store_id = receipt_record.store_id
  ) or (receipt_record.cashier_employee_id <> actor_employee_id and not can_access_store_receipts) then
    raise exception 'Receipt access is not permitted for this POS employee.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'receipt', jsonb_build_object(
      'id', receipt_record.receipt_id,
      'number', receipt_record.receipt_number,
      'issuedAt', receipt_record.issued_at,
      'layout', receipt_record.receipt_layout_snapshot
    ),
    'customerEmail', (
      select customer.email from public.customers customer
      where customer.organization_id = target_organization_id
        and customer.id = receipt_record.customer_id
    ),
    'sale', jsonb_build_object(
      'id', receipt_record.sale_id,
      'storeId', receipt_record.store_id,
      'registerId', receipt_record.register_id,
      'currencyCode', receipt_record.currency_code,
      'organizationName', receipt_record.organization_name_snapshot,
      'storeName', receipt_record.store_name_snapshot,
      'registerName', receipt_record.register_name_snapshot,
      'cashierName', receipt_record.cashier_name_snapshot,
      'subtotalMinor', receipt_record.subtotal_minor,
      'discountMinor', receipt_record.discount_minor,
      'taxMinor', receipt_record.tax_minor,
      'totalMinor', receipt_record.total_minor
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'name', case when item.variant_name_snapshot is null then item.product_name_snapshot else item.product_name_snapshot || ' · ' || item.variant_name_snapshot end,
        'sku', item.sku_snapshot,
        'quantity', item.quantity,
        'unit', item.unit_snapshot,
        'unitPriceMinor', item.unit_price_minor,
        'lineTotalMinor', item.line_total_minor
      ) order by item.created_at)
      from public.sale_items item
      where item.organization_id = target_organization_id and item.sale_id = receipt_record.sale_id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', payment.id,
        'name', payment.payment_method_name_snapshot,
        'type', payment.payment_method_type_snapshot,
        'amountMinor', payment.amount_minor,
        'tenderedMinor', payment.amount_tendered_minor,
        'changeMinor', payment.change_given_minor,
        'referenceNumber', payment.reference_number
      ) order by payment.created_at)
      from public.payments payment
      where payment.organization_id = target_organization_id and payment.sale_id = receipt_record.sale_id
    ), '[]'::jsonb),
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', refund.id,
        'number', refund.refund_number,
        'totalMinor', refund.total_minor,
        'completedAt', refund.completed_at,
        'reason', refund.reason,
        'paymentName', refund_payment.payment_method_name_snapshot,
        'paymentReference', refund_payment.reference_number,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', refund_item.id,
            'saleItemId', refund_item.sale_item_id,
            'name', case when refund_item.variant_name_snapshot is null then refund_item.product_name_snapshot else refund_item.product_name_snapshot || ' · ' || refund_item.variant_name_snapshot end,
            'quantity', refund_item.quantity,
            'unit', refund_item.unit_snapshot,
            'lineTotalMinor', refund_item.line_total_minor
          ) order by refund_item.created_at)
          from public.refund_items refund_item
          where refund_item.organization_id = target_organization_id and refund_item.refund_id = refund.id
        ), '[]'::jsonb)
      ) order by refund.completed_at desc)
      from public.refunds refund
      left join public.refund_payments refund_payment
        on refund_payment.organization_id = refund.organization_id
       and refund_payment.refund_id = refund.id
      where refund.organization_id = target_organization_id
        and refund.sale_id = receipt_record.sale_id
        and refund.status = 'completed'
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_pos_receipt_detail(uuid, uuid)
  from public, anon, service_role;
grant execute on function public.get_pos_receipt_detail(uuid, uuid) to authenticated;

create or replace function private.validate_refund_approval_payload(
  target_organization_id uuid,
  target_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_sale_id uuid;
  target_receipt_id uuid;
  target_receipt_number bigint;
  target_payment_method_id uuid;
  target_item jsonb;
  target_sale_item_id uuid;
  target_quantity integer;
  original_quantity integer;
  refunded_quantity integer;
  target_store_id uuid;
  requires_reference boolean;
  seen_item_ids uuid[] := array[]::uuid[];
begin
  begin
    target_sale_id := (target_payload ->> 'sale_id')::uuid;
    target_receipt_id := (target_payload ->> 'receipt_id')::uuid;
    target_receipt_number := (target_payload ->> 'receipt_number')::bigint;
    target_payment_method_id := (target_payload ->> 'payment_method_id')::uuid;
  exception when others then
    raise exception 'The refund approval no longer matches a valid receipt.' using errcode = '23514';
  end;

  select sale.store_id into target_store_id
  from public.sales sale
  join public.receipts receipt
    on receipt.organization_id = sale.organization_id
   and receipt.sale_id = sale.id
  where sale.organization_id = target_organization_id
    and sale.id = target_sale_id
    and sale.status = 'completed'
    and receipt.id = target_receipt_id
    and receipt.receipt_number = target_receipt_number;

  if target_store_id is null then
    raise exception 'This receipt is no longer refundable.' using errcode = '23514';
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

    if target_sale_item_id = any(seen_item_ids) or target_quantity not between 1 and 10000 then
      raise exception 'Refund approval items are invalid.' using errcode = '23514';
    end if;
    seen_item_ids := array_append(seen_item_ids, target_sale_item_id);

    select sale_item.quantity into original_quantity
    from public.sale_items sale_item
    where sale_item.organization_id = target_organization_id
      and sale_item.sale_id = target_sale_id
      and sale_item.id = target_sale_item_id;

    select coalesce(sum(refund_item.quantity), 0)::integer into refunded_quantity
    from public.refund_items refund_item
    join public.refunds refund
      on refund.organization_id = refund_item.organization_id
     and refund.id = refund_item.refund_id
     and refund.sale_id = target_sale_id
     and refund.status = 'completed'
    where refund_item.organization_id = target_organization_id
      and refund_item.sale_item_id = target_sale_item_id;

    if original_quantity is null or target_quantity + refunded_quantity > original_quantity then
      raise exception 'One or more refund quantities are no longer available.' using errcode = '23514';
    end if;
  end loop;

  select payment_method.requires_reference into requires_reference
  from public.payment_methods payment_method
  join public.store_payment_methods store_method
    on store_method.organization_id = payment_method.organization_id
   and store_method.payment_method_id = payment_method.id
   and store_method.store_id = target_store_id
   and store_method.is_enabled
  where payment_method.organization_id = target_organization_id
    and payment_method.id = target_payment_method_id
    and payment_method.is_enabled;

  if requires_reference is null then
    raise exception 'The selected refund method is no longer available.' using errcode = '23514';
  end if;
  if requires_reference and nullif(trim(coalesce(target_payload ->> 'reference_number', '')), '') is null then
    raise exception 'A reference is required for this refund method.' using errcode = '23514';
  end if;
end;
$$;

create or replace function private.validate_refund_approval_request_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.operation_code = 'sales.refund'
    and (tg_op = 'INSERT' or new.status = 'APPROVED') then
    perform private.validate_refund_approval_payload(new.organization_id, new.request_payload);
  end if;
  return new;
end;
$$;

drop trigger if exists approval_requests_validate_refund on public.approval_requests;
create trigger approval_requests_validate_refund
before insert or update of status on public.approval_requests
for each row execute function private.validate_refund_approval_request_trigger();

create or replace function private.decide_manager_approval(
  target_organization_id uuid,
  target_approval_request_id uuid,
  target_decision text
)
returns table (approval_request_id uuid, decision text, decided_at timestamptz)
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
  if target_decision not in ('APPROVED', 'REJECTED') then
    raise exception 'Choose Approve or Reject.' using errcode = '23514';
  end if;

  select * into request from public.approval_requests approval_request
  where approval_request.organization_id = target_organization_id
    and approval_request.id = target_approval_request_id
  for update;

  if request.id is null then raise exception 'The approval request was not found.' using errcode = 'P0002'; end if;
  if request.status <> 'PENDING' or request.expires_at <= now() then
    if request.status = 'PENDING' then
      update public.approval_requests set status = 'EXPIRED', updated_at = now()
      where organization_id = target_organization_id and id = request.id;
      return query select request.id, 'EXPIRED'::text, now();
      return;
    end if;
    raise exception 'This approval request is no longer pending.' using errcode = '23514';
  end if;

  required_permission := private.approval_operation_permission(request.operation_code);
  if actor_employee_id = request.requested_by_employee_id
    or not private.employee_has_permission(target_organization_id, actor_employee_id, 'approvals.authorize')
    or not private.employee_has_permission(target_organization_id, actor_employee_id, required_permission)
    or not exists (
      select 1 from public.employee_stores employee_store
      where employee_store.organization_id = target_organization_id
        and employee_store.employee_id = actor_employee_id
        and employee_store.store_id = request.store_id
    ) then
    raise exception 'A qualified approver assigned to this store is required.' using errcode = '42501';
  end if;

  update public.approval_requests
  set status = target_decision,
      approved_by_employee_id = case when target_decision = 'APPROVED' then actor_employee_id else null end,
      decided_at = now(),
      updated_at = now()
  where organization_id = target_organization_id and id = request.id;

  perform private.write_audit_log(
    target_organization_id,
    case when target_decision = 'APPROVED' then 'APPROVAL_APPROVED' else 'APPROVAL_REJECTED' end,
    request.operation_code,
    actor_employee_id,
    request.requested_by_employee_id,
    request.store_id,
    request.register_id,
    request.id,
    request.requested_amount_minor,
    request.reason,
    jsonb_build_object('approval_path', 'REMOTE')
  );

  return query select request.id, target_decision, now();
end;
$$;

create or replace function public.decide_manager_approval(
  target_organization_id uuid,
  target_approval_request_id uuid,
  target_decision text
)
returns table (approval_request_id uuid, decision text, decided_at timestamptz)
language sql
security invoker
set search_path = ''
as $$
  select * from private.decide_manager_approval(target_organization_id, target_approval_request_id, target_decision);
$$;

revoke execute on function private.validate_refund_approval_payload(uuid, jsonb),
  private.validate_refund_approval_request_trigger(),
  private.decide_manager_approval(uuid, uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.decide_manager_approval(uuid, uuid, text)
from public, anon, service_role;
grant execute on function public.decide_manager_approval(uuid, uuid, text) to authenticated;

drop policy if exists approval_requests_select_requester_or_approver on public.approval_requests;
create policy approval_requests_select_requester_or_store_approver
on public.approval_requests for select to authenticated
using (
  requested_by_employee_id = (select private.current_employee_id(organization_id))
  or (
    (
      (select private.has_permission(organization_id, 'approvals.authorize'))
      or (select private.has_permission(organization_id, 'approvals.manage'))
    )
    and exists (
      select 1 from public.employee_stores employee_store
      where employee_store.organization_id = approval_requests.organization_id
        and employee_store.employee_id = (select private.current_employee_id(approval_requests.organization_id))
        and employee_store.store_id = approval_requests.store_id
    )
  )
);

-- Bind the receipt reference into the exact, single-purpose payload consumed
-- by an approved refund. New requests cannot be replayed against another sale.
create or replace function public.refund_sale(
  target_organization_id uuid,
  target_sale_id uuid,
  target_payment_method_id uuid,
  target_idempotency_key uuid,
  target_reason text,
  target_reference_number text,
  target_items jsonb,
  target_approval_request_id uuid default null
)
returns table (refund_id uuid, refund_number bigint, total_minor bigint, was_replayed boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expected_payload jsonb;
  target_receipt_id uuid;
  target_receipt_number bigint;
begin
  select receipt.id, receipt.receipt_number
  into target_receipt_id, target_receipt_number
  from public.receipts receipt
  where receipt.organization_id = target_organization_id
    and receipt.sale_id = target_sale_id;

  expected_payload := jsonb_build_object(
    'items', target_items,
    'payment_method_id', target_payment_method_id,
    'reason', trim(coalesce(target_reason, '')),
    'receipt_id', target_receipt_id,
    'receipt_number', target_receipt_number,
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

  return query select * from private.refund_sale(
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

revoke execute on function public.refund_sale(uuid, uuid, uuid, uuid, text, text, jsonb, uuid)
from public, anon, service_role;
grant execute on function public.refund_sale(uuid, uuid, uuid, uuid, text, text, jsonb, uuid)
to authenticated;

-- The delivery queue is also a financial-document boundary. Enforce the same
-- assigned-store receipt scope used by the POS detail projection.
create or replace function public.queue_receipt_delivery(
  target_organization_id uuid,
  target_receipt_id uuid,
  target_delivery_channel text,
  target_recipient text,
  target_idempotency_key uuid
)
returns table (delivery_request_id uuid, delivery_status text, was_replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  normalized_channel text;
  normalized_recipient text;
  canonical_payload jsonb;
  existing_actor_employee_id uuid;
  existing_payload jsonb;
  existing_delivery_id uuid;
  existing_status text;
  new_delivery_id uuid;
begin
  if target_organization_id is null or target_receipt_id is null or target_idempotency_key is null
    or (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'receipts.reprint')) then
    raise exception 'Receipt reprint permission is required.' using errcode = '42501';
  end if;
  normalized_channel := upper(trim(coalesce(target_delivery_channel, '')));
  normalized_recipient := lower(trim(coalesce(target_recipient, '')));
  if normalized_channel <> 'EMAIL' or not private.valid_receipt_email(normalized_recipient) then
    raise exception 'Enter a valid email address for this digital receipt.' using errcode = '23514';
  end if;

  actor_employee_id := private.current_employee_id(target_organization_id);
  if actor_employee_id is null then
    raise exception 'An active employee record is required.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.receipts receipt
    where receipt.id = target_receipt_id
      and receipt.organization_id = target_organization_id
      and (select private.has_sale_read_scope(receipt.organization_id, receipt.sale_id))
  ) then
    raise exception 'The receipt was not found in your store scope.' using errcode = '42501';
  end if;

  canonical_payload := jsonb_build_object('delivery_channel', normalized_channel, 'recipient', normalized_recipient, 'receipt_id', target_receipt_id);
  select request.requested_by_employee_id,
    jsonb_build_object('delivery_channel', request.delivery_channel, 'recipient', request.recipient, 'receipt_id', request.receipt_id),
    request.id, request.status
  into existing_actor_employee_id, existing_payload, existing_delivery_id, existing_status
  from public.receipt_delivery_requests request
  where request.organization_id = target_organization_id and request.idempotency_key = target_idempotency_key
  for update;

  if found then
    if existing_actor_employee_id is distinct from actor_employee_id or existing_payload is distinct from canonical_payload then
      raise exception 'This delivery key was already used for a different request.' using errcode = '23505';
    end if;
    return query select existing_delivery_id, existing_status, true;
    return;
  end if;

  insert into public.receipt_delivery_requests (
    organization_id, receipt_id, requested_by_employee_id, idempotency_key, delivery_channel, recipient
  ) values (
    target_organization_id, target_receipt_id, actor_employee_id, target_idempotency_key, normalized_channel, normalized_recipient
  ) returning id into new_delivery_id;
  return query select new_delivery_id, 'QUEUED'::text, false;
end;
$$;

revoke execute on function public.queue_receipt_delivery(uuid, uuid, text, text, uuid)
from public, anon, service_role;
grant execute on function public.queue_receipt_delivery(uuid, uuid, text, text, uuid)
to authenticated;

commit;
