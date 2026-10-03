-- TINDIO Phase 26: aggregate operational observability.
begin;

alter table public.pos_device_sync_telemetry
  add column if not exists crash_count bigint not null default 0 check (crash_count >= 0),
  add column if not exists crash_window_started_at timestamptz,
  add column if not exists last_crash_at timestamptz,
  add column if not exists api_average_latency_ms integer not null default 0 check (api_average_latency_ms >= 0),
  add column if not exists api_max_latency_ms integer not null default 0 check (api_max_latency_ms >= 0),
  add column if not exists api_failure_count integer not null default 0 check (api_failure_count >= 0),
  add column if not exists sync_average_latency_ms integer not null default 0 check (sync_average_latency_ms >= 0),
  add column if not exists sync_max_latency_ms integer not null default 0 check (sync_max_latency_ms >= 0),
  add column if not exists local_database_health text not null default 'UNKNOWN' check (local_database_health in ('HEALTHY', 'CHECK_REQUIRED', 'UNAVAILABLE', 'UNKNOWN')),
  add column if not exists local_schema_version integer not null default 0 check (local_schema_version >= 0);

drop function if exists public.report_pos_device_sync_telemetry(uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,bigint,bigint,integer,integer,integer,timestamptz);

create or replace function public.report_pos_device_sync_telemetry(
  target_organization_id uuid, target_device_id uuid, target_store_id uuid, target_register_id uuid,
  target_employee_id uuid, target_employee_name text, target_connection_mode text, target_app_version text,
  target_last_successful_sync_at timestamptz, target_device_checkpoint bigint, target_server_checkpoint bigint,
  target_queue_depth integer, target_conflict_count integer, target_failed_count integer, target_offline_since timestamptz,
  target_crash_count bigint default 0, target_crash_window_started_at timestamptz default null, target_last_crash_at timestamptz default null,
  target_api_average_latency_ms integer default 0, target_api_max_latency_ms integer default 0, target_api_failure_count integer default 0,
  target_sync_average_latency_ms integer default 0, target_sync_max_latency_ms integer default 0,
  target_local_database_health text default 'UNKNOWN', target_local_schema_version integer default 0
)
returns table (device_id uuid, heartbeat_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare actor_employee_id uuid; verified_store_id uuid; verified_register_id uuid;
begin
  actor_employee_id := private.current_employee_id(target_organization_id);
  if actor_employee_id is null or actor_employee_id <> target_employee_id or not private.has_permission(target_organization_id, 'pos.access') then
    raise exception 'POS telemetry requires an active POS employee.' using errcode = '42501';
  end if;
  if target_connection_mode not in ('CLOUD_ONLINE', 'STORE_LOCAL', 'DEVICE_ISOLATED', 'RECOVERING', 'SYNC_REVIEW')
    or target_local_database_health not in ('HEALTHY', 'CHECK_REQUIRED', 'UNAVAILABLE', 'UNKNOWN') then
    raise exception 'Invalid POS telemetry state.' using errcode = '23514';
  end if;
  if target_crash_count < 0 or target_api_average_latency_ms < 0 or target_api_max_latency_ms < 0 or target_api_failure_count < 0
    or target_sync_average_latency_ms < 0 or target_sync_max_latency_ms < 0 or target_local_schema_version < 0
    or target_device_checkpoint < 0 or target_server_checkpoint < 0 or target_queue_depth < 0 or target_conflict_count < 0 or target_failed_count < 0 then
    raise exception 'Invalid POS telemetry counters.' using errcode = '23514';
  end if;
  select device.store_id, device.register_id into verified_store_id, verified_register_id
  from public.pos_devices device where device.organization_id = target_organization_id and device.id = target_device_id and device.status = 'active';
  if verified_store_id is null or verified_store_id <> target_store_id or verified_register_id <> target_register_id then
    raise exception 'POS device telemetry binding mismatch.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employee_stores assignment where assignment.organization_id = target_organization_id and assignment.employee_id = actor_employee_id and assignment.store_id = target_store_id) then
    raise exception 'POS employee is not assigned to this device store.' using errcode = '42501';
  end if;
  insert into public.pos_device_sync_telemetry (
    organization_id,device_id,store_id,register_id,employee_id,employee_name_snapshot,connection_mode,app_version,last_heartbeat_at,last_successful_sync_at,device_checkpoint,server_checkpoint,queue_depth,conflict_count,failed_count,offline_since,
    crash_count,crash_window_started_at,last_crash_at,api_average_latency_ms,api_max_latency_ms,api_failure_count,sync_average_latency_ms,sync_max_latency_ms,local_database_health,local_schema_version,updated_at
  ) values (
    target_organization_id,target_device_id,target_store_id,target_register_id,target_employee_id,left(trim(target_employee_name),160),target_connection_mode,left(trim(target_app_version),80),now(),target_last_successful_sync_at,target_device_checkpoint,target_server_checkpoint,target_queue_depth,target_conflict_count,target_failed_count,target_offline_since,
    target_crash_count,target_crash_window_started_at,target_last_crash_at,target_api_average_latency_ms,target_api_max_latency_ms,target_api_failure_count,target_sync_average_latency_ms,target_sync_max_latency_ms,target_local_database_health,target_local_schema_version,now()
  ) on conflict on constraint pos_device_sync_telemetry_pkey do update set
    store_id=excluded.store_id, register_id=excluded.register_id, employee_id=excluded.employee_id, employee_name_snapshot=excluded.employee_name_snapshot,
    connection_mode=excluded.connection_mode, app_version=excluded.app_version, last_heartbeat_at=excluded.last_heartbeat_at, last_successful_sync_at=excluded.last_successful_sync_at,
    device_checkpoint=excluded.device_checkpoint, server_checkpoint=excluded.server_checkpoint, queue_depth=excluded.queue_depth, conflict_count=excluded.conflict_count, failed_count=excluded.failed_count, offline_since=excluded.offline_since,
    crash_count=excluded.crash_count, crash_window_started_at=excluded.crash_window_started_at, last_crash_at=excluded.last_crash_at, api_average_latency_ms=excluded.api_average_latency_ms, api_max_latency_ms=excluded.api_max_latency_ms, api_failure_count=excluded.api_failure_count, sync_average_latency_ms=excluded.sync_average_latency_ms, sync_max_latency_ms=excluded.sync_max_latency_ms, local_database_health=excluded.local_database_health, local_schema_version=excluded.local_schema_version, updated_at=now();
  return query select target_device_id, now();
end;
$$;

revoke execute on function public.report_pos_device_sync_telemetry(uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,bigint,bigint,integer,integer,integer,timestamptz,bigint,timestamptz,timestamptz,integer,integer,integer,integer,integer,text,integer) from public, anon, service_role;
grant execute on function public.report_pos_device_sync_telemetry(uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,bigint,bigint,integer,integer,integer,timestamptz,bigint,timestamptz,timestamptz,integer,integer,integer,integer,integer,text,integer) to authenticated;

notify pgrst, 'reload schema';
commit;
