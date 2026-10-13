-- MOB-10 A30: a manager-approved replay may legitimately turn a prior
-- sequence conflict into one applied checkout. Keep APPLIED terminal and
-- repair only rows whose completed checkout and sync event prove success.

begin;

create or replace function public.finalize_pos_device_sequence(
  target_organization_id uuid,
  target_device_id uuid,
  target_device_sequence bigint,
  target_idempotency_key uuid,
  target_final_state text
) returns table(server_checkpoint bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  receipt public.pos_device_sequence_receipts%rowtype;
  current_checkpoint bigint;
  normalized_state text;
  device_store_id uuid;
  device_register_id uuid;
begin
  normalized_state := upper(nullif(btrim(coalesce(target_final_state, '')), ''));
  if normalized_state not in ('APPLIED', 'CONFLICT') then
    raise exception 'The sequence finalization state is invalid.' using errcode = '23514';
  end if;

  select device.store_id, device.register_id
  into device_store_id, device_register_id
  from public.pos_devices device
  where device.organization_id = target_organization_id
    and device.id = target_device_id;

  perform private.require_pos_sequence_access(
    target_organization_id,
    target_device_id,
    device_store_id,
    device_register_id
  );

  select checkpoint.server_checkpoint
  into current_checkpoint
  from public.pos_device_sync_checkpoints checkpoint
  where checkpoint.organization_id = target_organization_id
    and checkpoint.device_id = target_device_id
  for update;

  select *
  into receipt
  from public.pos_device_sequence_receipts candidate
  where candidate.organization_id = target_organization_id
    and candidate.device_id = target_device_id
    and candidate.device_sequence = target_device_sequence
  for update;

  if receipt.idempotency_key is null or receipt.idempotency_key <> target_idempotency_key then
    raise exception 'The sequence receipt does not match this checkout.' using errcode = '23514';
  end if;

  if receipt.state = 'RECEIVED'
     or (receipt.state = 'CONFLICT' and normalized_state = 'APPLIED') then
    update public.pos_device_sequence_receipts
    set state = normalized_state,
        finalized_at = now()
    where organization_id = target_organization_id
      and device_id = target_device_id
      and device_sequence = target_device_sequence;
  end if;

  if target_device_sequence = current_checkpoint + 1 then
    update public.pos_device_sync_checkpoints
    set server_checkpoint = target_device_sequence,
        updated_at = now()
    where organization_id = target_organization_id
      and device_id = target_device_id;
    current_checkpoint := target_device_sequence;
  end if;

  server_checkpoint := current_checkpoint;
  return next;
end;
$$;

comment on function public.finalize_pos_device_sequence(uuid, uuid, bigint, uuid, text)
is 'Finalizes a device sequence without regressing APPLIED. A successful same-identity replay may promote CONFLICT to APPLIED.';

update public.pos_device_sequence_receipts receipt
set state = 'APPLIED',
    finalized_at = greatest(
      coalesce(receipt.finalized_at, '-infinity'::timestamptz),
      sync_event.last_attempt_at
    )
from public.offline_sync_events sync_event
where receipt.organization_id = sync_event.organization_id
  and receipt.device_id = sync_event.device_id
  and receipt.idempotency_key = sync_event.idempotency_key
  and receipt.local_receipt_reference = sync_event.local_receipt_reference
  and receipt.state = 'CONFLICT'
  and sync_event.state = 'SYNCED'
  and (
    exists (
      select 1
      from public.checkout_requests checkout
      where checkout.organization_id = receipt.organization_id
        and checkout.idempotency_key = receipt.idempotency_key
        and checkout.state = 'completed'
        and checkout.sale_id is not null
    )
    or exists (
      select 1
      from public.advanced_checkout_requests advanced_checkout
      where advanced_checkout.organization_id = receipt.organization_id
        and advanced_checkout.idempotency_key = receipt.idempotency_key
        and advanced_checkout.state = 'completed'
        and advanced_checkout.sale_id is not null
    )
  );

revoke execute on function public.finalize_pos_device_sequence(uuid, uuid, bigint, uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.finalize_pos_device_sequence(uuid, uuid, bigint, uuid, text)
to tindio_authenticated;

notify pgrst, 'reload schema';
commit;
