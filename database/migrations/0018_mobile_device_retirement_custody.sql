-- MOB-10 A44: require an explicit, server-authoritative custody decision before
-- disabling or replacing a POS device. A genuinely unavailable device can be
-- retired only through an audited bounded-loss path; Store Hub metadata is not
-- treated as a financial transaction backup.

begin;

alter table private.pos_shift_custody_leases
  add column if not exists loss_decided_at timestamptz,
  add column if not exists loss_decided_by_employee_id uuid,
  add column if not exists loss_reason text;

alter table private.pos_shift_custody_leases
  drop constraint if exists pos_shift_custody_leases_state_check,
  drop constraint if exists pos_shift_custody_leases_clear_state_check;

alter table private.pos_shift_custody_leases
  add constraint pos_shift_custody_leases_state_check
    check (state in ('ACTIVE', 'CLEARED', 'LOST')),
  add constraint pos_shift_custody_leases_clear_state_check
    check (
      (
        state = 'ACTIVE'
        and cleared_at is null
        and cleared_server_sequence is null
        and finalization_token is null
        and loss_decided_at is null
        and loss_decided_by_employee_id is null
        and loss_reason is null
      )
      or
      (
        state = 'CLEARED'
        and cleared_at is not null
        and cleared_server_sequence is not null
        and finalization_token is not null
        and loss_decided_at is null
        and loss_decided_by_employee_id is null
        and loss_reason is null
      )
      or
      (
        state = 'LOST'
        and cleared_at is null
        and cleared_server_sequence is null
        and finalization_token is null
        and loss_decided_at is not null
        and loss_decided_by_employee_id is not null
        and loss_reason is not null
      )
    );

comment on column private.pos_shift_custody_leases.loss_decided_at is
  'Time an authorized fleet manager accepted the bounded loss of local-only transactions on an unavailable device.';
comment on column private.pos_shift_custody_leases.loss_decided_by_employee_id is
  'Employee who made the explicit unavailable-device custody decision.';
comment on column private.pos_shift_custody_leases.loss_reason is
  'Required operator explanation for an unavailable-device bounded-loss decision.';

-- Legacy callers must fail safely instead of bypassing the custody-decision
-- contract. The signature is retained so old clients receive a recoverable
-- business-rule response rather than an ambiguous missing-function failure.
create or replace function public.revoke_pos_device(
  target_organization_id uuid,
  target_device_id uuid,
  target_reason text default null
)
returns table (
  device_id uuid,
  status text,
  revoked_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_device_manager(target_organization_id);
  raise exception 'Device retirement now requires an explicit transaction-custody decision. Refresh Fleet Management and try again.'
    using errcode = '23514';
end;
$$;

create or replace function public.retire_pos_device(
  target_organization_id uuid,
  target_device_id uuid,
  target_custody_decision text,
  target_reason text,
  target_loss_confirmation text default null
)
returns table (
  device_id uuid,
  status text,
  revoked_at timestamptz,
  custody_decision text,
  lost_custody_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  device_record public.pos_devices%rowtype;
  telemetry_record public.pos_device_sync_telemetry%rowtype;
  normalized_decision text;
  normalized_reason text;
  active_custody_count integer;
  changed_custody_count integer := 0;
  retired_at timestamptz;
begin
  actor_employee_id := private.require_device_manager(target_organization_id);
  normalized_decision := upper(trim(coalesce(target_custody_decision, '')));
  normalized_reason := nullif(left(trim(coalesce(target_reason, '')), 500), '');

  if normalized_decision not in ('RECONCILED', 'DEVICE_UNAVAILABLE_ACCEPT_BOUNDED_LOSS') then
    raise exception 'Choose whether the terminal is reconciled or unavailable with bounded loss accepted.'
      using errcode = '23514';
  end if;
  if normalized_reason is null or char_length(normalized_reason) < 10 then
    raise exception 'Enter a specific device-retirement reason of at least 10 characters.'
      using errcode = '23514';
  end if;

  select device.*
  into device_record
  from public.pos_devices device
  where device.id = target_device_id
    and device.organization_id = target_organization_id
    and device.status = 'active'
  for update;

  if device_record.id is null then
    raise exception 'The active POS device was not found.' using errcode = 'P0002';
  end if;

  select telemetry.*
  into telemetry_record
  from public.pos_device_sync_telemetry telemetry
  where telemetry.organization_id = target_organization_id
    and telemetry.device_id = target_device_id
  for update;

  select count(*)::integer
  into active_custody_count
  from private.pos_shift_custody_leases lease
  where lease.organization_id = target_organization_id
    and lease.device_id = target_device_id
    and lease.state = 'ACTIVE';

  if normalized_decision = 'RECONCILED' then
    if active_custody_count > 0 then
      raise exception 'This device still has active offline shift custody. Finalize its shift before marking it reconciled.'
        using errcode = '23514';
    end if;
    if telemetry_record.device_id is null
      or telemetry_record.connection_mode <> 'CLOUD_ONLINE'
      or telemetry_record.queue_depth <> 0
      or telemetry_record.conflict_count <> 0
      or telemetry_record.failed_count <> 0
      or telemetry_record.device_checkpoint > telemetry_record.server_checkpoint
      or telemetry_record.last_heartbeat_at < now() - interval '15 minutes' then
      raise exception 'Current cloud telemetry does not prove this terminal is reconciled. Reconnect and sync it, or use the unavailable-device bounded-loss decision.'
        using errcode = '23514';
    end if;
  else
    if target_loss_confirmation is distinct from 'ACCEPT LOCAL-ONLY TRANSACTION LOSS' then
      raise exception 'Type the exact bounded-loss confirmation before retiring an unavailable device.'
        using errcode = '23514';
    end if;

    update private.pos_shift_custody_leases lease
    set
      state = 'LOST',
      loss_decided_at = now(),
      loss_decided_by_employee_id = actor_employee_id,
      loss_reason = normalized_reason,
      last_renewed_at = now()
    where lease.organization_id = target_organization_id
      and lease.device_id = target_device_id
      and lease.state = 'ACTIVE';
    get diagnostics changed_custody_count = row_count;
  end if;

  update public.pos_devices device
  set
    status = 'revoked',
    revoked_at = now(),
    revoked_by_employee_id = actor_employee_id
  where device.id = device_record.id
    and device.organization_id = target_organization_id
  returning device.revoked_at into retired_at;

  perform private.write_audit_log(
    target_organization_id,
    'DEVICE_RETIRED_WITH_CUSTODY_DECISION',
    'devices.retire',
    actor_employee_id,
    null,
    device_record.store_id,
    device_record.register_id,
    null,
    null,
    normalized_reason,
    jsonb_build_object(
      'device_id', target_device_id,
      'device_name', device_record.name,
      'custody_decision', normalized_decision,
      'lost_custody_count', changed_custody_count,
      'store_hub_financial_backup', false,
      'telemetry_last_heartbeat_at', telemetry_record.last_heartbeat_at,
      'telemetry_connection_mode', telemetry_record.connection_mode,
      'telemetry_queue_depth', telemetry_record.queue_depth,
      'telemetry_conflict_count', telemetry_record.conflict_count,
      'telemetry_failed_count', telemetry_record.failed_count,
      'telemetry_device_checkpoint', telemetry_record.device_checkpoint,
      'telemetry_server_checkpoint', telemetry_record.server_checkpoint
    )
  );

  device_id := device_record.id;
  status := 'revoked';
  revoked_at := retired_at;
  custody_decision := normalized_decision;
  lost_custody_count := changed_custody_count;
  return next;
end;
$$;

comment on function public.retire_pos_device(uuid, uuid, text, text, text) is
  'Retires one tenant-scoped POS device after a server-validated reconciled decision or an explicit, audited unavailable-device bounded-loss decision. Store Hub data is not a financial backup.';

revoke all on function public.revoke_pos_device(uuid, uuid, text)
  from public, anon, authenticated, service_role, tindio_anon, tindio_service;
grant execute on function public.revoke_pos_device(uuid, uuid, text)
  to tindio_authenticated;
revoke all on function public.retire_pos_device(uuid, uuid, text, text, text)
  from public, anon, authenticated, service_role, tindio_anon, tindio_authenticated, tindio_service;
grant execute on function public.retire_pos_device(uuid, uuid, text, text, text)
  to tindio_authenticated;

notify pgrst, 'reload schema';
commit;
