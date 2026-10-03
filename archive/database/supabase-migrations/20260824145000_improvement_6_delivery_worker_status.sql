-- Provide a narrow, service-only handoff for a future digital-receipt worker.
-- The worker never receives direct write access to receipt delivery records.

begin;

create or replace function public.update_receipt_delivery_status(
  target_delivery_request_id uuid,
  target_status text,
  target_provider_message_id text default null,
  target_failure_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery_record public.receipt_delivery_requests%rowtype;
  normalized_status text;
  normalized_provider_message_id text;
  normalized_failure_reason text;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Only the configured delivery worker can update receipt delivery status.'
      using errcode = '42501';
  end if;

  normalized_status := upper(trim(coalesce(target_status, '')));
  normalized_provider_message_id := nullif(trim(coalesce(target_provider_message_id, '')), '');
  normalized_failure_reason := nullif(trim(coalesce(target_failure_reason, '')), '');

  if normalized_status not in ('DELIVERED', 'FAILED')
    or (normalized_status = 'FAILED' and char_length(coalesce(normalized_failure_reason, '')) not between 2 and 500)
    or (normalized_provider_message_id is not null and char_length(normalized_provider_message_id) not between 1 and 320) then
    raise exception 'Check the receipt delivery status result.' using errcode = '23514';
  end if;

  select request.*
  into delivery_record
  from public.receipt_delivery_requests request
  where request.id = target_delivery_request_id
  for update;

  if delivery_record.id is null then
    raise exception 'The receipt delivery request was not found.' using errcode = 'P0002';
  end if;

  if delivery_record.status = normalized_status then
    return true;
  end if;

  if delivery_record.status <> 'QUEUED' then
    raise exception 'Only a queued receipt delivery request can be completed.' using errcode = '23514';
  end if;

  update public.receipt_delivery_requests request
  set
    status = normalized_status,
    provider_message_id = normalized_provider_message_id,
    delivered_at = case when normalized_status = 'DELIVERED' then now() else null end,
    failed_at = case when normalized_status = 'FAILED' then now() else null end,
    failure_reason = case when normalized_status = 'FAILED' then normalized_failure_reason else null end
  where request.id = delivery_record.id;

  return true;
end;
$$;

create or replace function private.audit_receipt_delivery_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sale_record public.sales%rowtype;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  select sale.*
  into sale_record
  from public.receipts receipt
  join public.sales sale
    on sale.id = receipt.sale_id
   and sale.organization_id = receipt.organization_id
  where receipt.id = new.receipt_id
    and receipt.organization_id = new.organization_id;

  perform private.write_audit_log(
    new.organization_id,
    case new.status
      when 'DELIVERED' then 'RECEIPT_DELIVERY_DELIVERED'
      when 'FAILED' then 'RECEIPT_DELIVERY_FAILED'
      else 'RECEIPT_DELIVERY_STATUS_UPDATED'
    end,
    'receipts.reprint',
    new.requested_by_employee_id,
    null,
    sale_record.store_id,
    sale_record.register_id,
    null,
    null,
    new.failure_reason,
    jsonb_build_object(
      'delivery_request_id', new.id,
      'receipt_id', new.receipt_id,
      'delivery_channel', new.delivery_channel,
      'delivery_status', new.status,
      'provider_message_id', new.provider_message_id
    )
  );
  return new;
end;
$$;

drop trigger if exists receipt_delivery_requests_status_audit_log on public.receipt_delivery_requests;
create trigger receipt_delivery_requests_status_audit_log
after update of status on public.receipt_delivery_requests
for each row execute function private.audit_receipt_delivery_status();

revoke execute on function private.audit_receipt_delivery_status() from public, anon, authenticated, service_role;
revoke execute on function public.update_receipt_delivery_status(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.update_receipt_delivery_status(uuid, text, text, text) to service_role;

comment on function public.update_receipt_delivery_status(uuid, text, text, text)
is 'Service-only delivery-worker handoff. Transitions one queued receipt email request to DELIVERED or FAILED and records an audit event.';

commit;
