-- MOB-10 A45: extend the existing aggregate telemetry path with sanitized,
-- tenant-scoped operational alerts routed to a named devices.manage operator.
-- No transaction payload or financial-custody table is read or mutated.

begin;

alter table public.pos_device_sync_telemetry
  add column if not exists anr_count bigint not null default 0 check (anr_count >= 0),
  add column if not exists last_anr_at timestamptz;

create table if not exists public.pos_operational_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  device_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  alert_type text not null check (alert_type in ('APP_CRASH', 'ANR', 'API_OUTAGE', 'STALE_QUEUE')),
  severity text not null check (severity in ('WARNING', 'CRITICAL')),
  status text not null default 'OPEN' check (status in ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  assigned_employee_id uuid not null,
  assigned_employee_name text not null check (char_length(assigned_employee_name) between 1 and 160),
  escalation_channel text not null check (char_length(escalation_channel) between 2 and 120),
  runbook_key text not null check (runbook_key in ('APP_CRASH', 'ANR', 'API_OUTAGE', 'STALE_QUEUE')),
  diagnostic jsonb not null default '{}'::jsonb check (jsonb_typeof(diagnostic) = 'object'),
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by_employee_id uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_operational_alerts_device_fkey foreign key (device_id, organization_id)
    references public.pos_devices (id, organization_id) on delete restrict,
  constraint pos_operational_alerts_store_fkey foreign key (store_id, organization_id)
    references public.stores (id, organization_id) on delete restrict,
  constraint pos_operational_alerts_register_fkey foreign key (register_id, organization_id)
    references public.registers (id, organization_id) on delete restrict,
  constraint pos_operational_alerts_assignee_fkey foreign key (assigned_employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict,
  constraint pos_operational_alerts_acknowledger_fkey foreign key (acknowledged_by_employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict,
  constraint pos_operational_alerts_device_type_unique unique (organization_id, device_id, alert_type)
);

create index if not exists pos_operational_alerts_org_status_detected_idx
  on public.pos_operational_alerts (organization_id, status, last_detected_at desc);

alter table public.pos_operational_alerts enable row level security;
revoke all on table public.pos_operational_alerts from public, anon, authenticated, service_role, tindio_anon, tindio_authenticated, tindio_service;

create or replace function private.route_pos_operational_alert(
  target_organization_id uuid,
  target_device_id uuid,
  target_store_id uuid,
  target_register_id uuid,
  target_actor_employee_id uuid,
  target_alert_type text,
  target_severity text,
  target_diagnostic jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  operator_employee_id uuid;
  operator_name text;
begin
  if target_alert_type not in ('APP_CRASH', 'ANR', 'API_OUTAGE', 'STALE_QUEUE')
    or target_severity not in ('WARNING', 'CRITICAL')
    or jsonb_typeof(target_diagnostic) <> 'object' then
    raise exception 'Invalid operational alert.' using errcode = '23514';
  end if;

  select employee.id, coalesce(nullif(trim(profile.full_name), ''), employee.employee_number)
  into operator_employee_id, operator_name
  from public.employees employee
  join public.profiles profile on profile.id = employee.profile_id
  join public.employee_roles employee_role
    on employee_role.organization_id = employee.organization_id and employee_role.employee_id = employee.id
  join public.role_permissions role_permission
    on role_permission.organization_id = employee_role.organization_id and role_permission.role_id = employee_role.role_id
  where employee.organization_id = target_organization_id
    and employee.status = 'active'
    and role_permission.permission_code = 'devices.manage'
  order by (employee.id = target_actor_employee_id) desc, profile.full_name, employee.id
  limit 1;

  -- Telemetry must remain non-blocking when a tenant has not configured any
  -- eligible operational manager. The dashboard exposes the missing route as
  -- a release blocker; no cashier transaction is failed by observability.
  if operator_employee_id is null then return; end if;

  insert into public.pos_operational_alerts (
    organization_id, device_id, store_id, register_id, alert_type, severity,
    assigned_employee_id, assigned_employee_name, escalation_channel,
    runbook_key, diagnostic
  ) values (
    target_organization_id, target_device_id, target_store_id, target_register_id,
    target_alert_type, target_severity, operator_employee_id, operator_name,
    'Back Office > Production Observability', target_alert_type, target_diagnostic
  )
  on conflict on constraint pos_operational_alerts_device_type_unique do update set
    store_id = excluded.store_id,
    register_id = excluded.register_id,
    severity = excluded.severity,
    assigned_employee_id = excluded.assigned_employee_id,
    assigned_employee_name = excluded.assigned_employee_name,
    escalation_channel = excluded.escalation_channel,
    runbook_key = excluded.runbook_key,
    diagnostic = excluded.diagnostic,
    occurrence_count = public.pos_operational_alerts.occurrence_count
      + case when public.pos_operational_alerts.diagnostic is distinct from excluded.diagnostic then 1 else 0 end,
    status = case when public.pos_operational_alerts.status = 'RESOLVED' then 'OPEN' else public.pos_operational_alerts.status end,
    acknowledged_at = case when public.pos_operational_alerts.status = 'RESOLVED' then null else public.pos_operational_alerts.acknowledged_at end,
    acknowledged_by_employee_id = case when public.pos_operational_alerts.status = 'RESOLVED' then null else public.pos_operational_alerts.acknowledged_by_employee_id end,
    resolved_at = null,
    last_detected_at = now(),
    updated_at = now();
end;
$$;

create or replace function private.resolve_pos_operational_alert(
  target_organization_id uuid,
  target_device_id uuid,
  target_alert_type text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.pos_operational_alerts
  set status = 'RESOLVED', resolved_at = now(), updated_at = now()
  where organization_id = target_organization_id
    and device_id = target_device_id
    and alert_type = target_alert_type
    and status <> 'RESOLVED';
$$;

revoke all on function private.route_pos_operational_alert(uuid,uuid,uuid,uuid,uuid,text,text,jsonb) from public, anon, authenticated, service_role, tindio_anon, tindio_authenticated, tindio_service;
revoke all on function private.resolve_pos_operational_alert(uuid,uuid,text) from public, anon, authenticated, service_role, tindio_anon, tindio_authenticated, tindio_service;

drop function if exists public.report_pos_device_sync_telemetry(uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,bigint,bigint,integer,integer,integer,timestamptz,bigint,timestamptz,timestamptz,integer,integer,integer,integer,integer,text,integer);

create or replace function public.report_pos_device_sync_telemetry(
  target_organization_id uuid, target_device_id uuid, target_store_id uuid, target_register_id uuid,
  target_employee_id uuid, target_employee_name text, target_connection_mode text, target_app_version text,
  target_last_successful_sync_at timestamptz, target_device_checkpoint bigint, target_server_checkpoint bigint,
  target_queue_depth integer, target_conflict_count integer, target_failed_count integer, target_offline_since timestamptz,
  target_crash_count bigint default 0, target_crash_window_started_at timestamptz default null, target_last_crash_at timestamptz default null,
  target_anr_count bigint default 0, target_last_anr_at timestamptz default null,
  target_api_average_latency_ms integer default 0, target_api_max_latency_ms integer default 0, target_api_failure_count integer default 0,
  target_sync_average_latency_ms integer default 0, target_sync_max_latency_ms integer default 0,
  target_local_database_health text default 'UNKNOWN', target_local_schema_version integer default 0
)
returns table (device_id uuid, heartbeat_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  actor_employee_id uuid;
  verified_store_id uuid;
  verified_register_id uuid;
  previous_crash_count bigint := 0;
  previous_anr_count bigint := 0;
  previous_api_failure_count integer := 0;
  stale_queue boolean;
begin
  actor_employee_id := private.current_employee_id(target_organization_id);
  if actor_employee_id is null or actor_employee_id <> target_employee_id or not private.has_permission(target_organization_id, 'pos.access') then
    raise exception 'POS telemetry requires an active POS employee.' using errcode = '42501';
  end if;
  if target_connection_mode not in ('CLOUD_ONLINE', 'STORE_LOCAL', 'DEVICE_ISOLATED', 'RECOVERING', 'SYNC_REVIEW')
    or target_local_database_health not in ('HEALTHY', 'CHECK_REQUIRED', 'UNAVAILABLE', 'UNKNOWN') then
    raise exception 'Invalid POS telemetry state.' using errcode = '23514';
  end if;
  if target_crash_count < 0 or target_anr_count < 0 or target_api_average_latency_ms < 0 or target_api_max_latency_ms < 0 or target_api_failure_count < 0
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

  select telemetry.crash_count, telemetry.anr_count, telemetry.api_failure_count
  into previous_crash_count, previous_anr_count, previous_api_failure_count
  from public.pos_device_sync_telemetry telemetry
  where telemetry.organization_id = target_organization_id and telemetry.device_id = target_device_id
  for update;
  previous_crash_count := coalesce(previous_crash_count, 0);
  previous_anr_count := coalesce(previous_anr_count, 0);
  previous_api_failure_count := coalesce(previous_api_failure_count, 0);

  insert into public.pos_device_sync_telemetry (
    organization_id,device_id,store_id,register_id,employee_id,employee_name_snapshot,connection_mode,app_version,last_heartbeat_at,last_successful_sync_at,device_checkpoint,server_checkpoint,queue_depth,conflict_count,failed_count,offline_since,
    crash_count,crash_window_started_at,last_crash_at,anr_count,last_anr_at,api_average_latency_ms,api_max_latency_ms,api_failure_count,sync_average_latency_ms,sync_max_latency_ms,local_database_health,local_schema_version,updated_at
  ) values (
    target_organization_id,target_device_id,target_store_id,target_register_id,target_employee_id,left(trim(target_employee_name),160),target_connection_mode,left(trim(target_app_version),80),now(),target_last_successful_sync_at,target_device_checkpoint,target_server_checkpoint,target_queue_depth,target_conflict_count,target_failed_count,target_offline_since,
    target_crash_count,target_crash_window_started_at,target_last_crash_at,target_anr_count,target_last_anr_at,target_api_average_latency_ms,target_api_max_latency_ms,target_api_failure_count,target_sync_average_latency_ms,target_sync_max_latency_ms,target_local_database_health,target_local_schema_version,now()
  ) on conflict on constraint pos_device_sync_telemetry_pkey do update set
    store_id=excluded.store_id, register_id=excluded.register_id, employee_id=excluded.employee_id, employee_name_snapshot=excluded.employee_name_snapshot,
    connection_mode=excluded.connection_mode, app_version=excluded.app_version, last_heartbeat_at=excluded.last_heartbeat_at, last_successful_sync_at=excluded.last_successful_sync_at,
    device_checkpoint=excluded.device_checkpoint, server_checkpoint=excluded.server_checkpoint, queue_depth=excluded.queue_depth, conflict_count=excluded.conflict_count, failed_count=excluded.failed_count, offline_since=excluded.offline_since,
    crash_count=excluded.crash_count, crash_window_started_at=excluded.crash_window_started_at, last_crash_at=excluded.last_crash_at, anr_count=excluded.anr_count, last_anr_at=excluded.last_anr_at,
    api_average_latency_ms=excluded.api_average_latency_ms, api_max_latency_ms=excluded.api_max_latency_ms, api_failure_count=excluded.api_failure_count, sync_average_latency_ms=excluded.sync_average_latency_ms, sync_max_latency_ms=excluded.sync_max_latency_ms, local_database_health=excluded.local_database_health, local_schema_version=excluded.local_schema_version, updated_at=now();

  if target_crash_count > previous_crash_count then
    perform private.route_pos_operational_alert(target_organization_id,target_device_id,target_store_id,target_register_id,actor_employee_id,'APP_CRASH','CRITICAL',jsonb_build_object('app_version',left(trim(target_app_version),80),'crash_count',target_crash_count,'last_crash_at',target_last_crash_at));
  end if;
  if target_anr_count > previous_anr_count then
    perform private.route_pos_operational_alert(target_organization_id,target_device_id,target_store_id,target_register_id,actor_employee_id,'ANR','CRITICAL',jsonb_build_object('app_version',left(trim(target_app_version),80),'anr_count',target_anr_count,'last_anr_at',target_last_anr_at));
  end if;
  if target_connection_mode <> 'CLOUD_ONLINE' and target_api_failure_count > 0 then
    perform private.route_pos_operational_alert(target_organization_id,target_device_id,target_store_id,target_register_id,actor_employee_id,'API_OUTAGE','CRITICAL',jsonb_build_object('app_version',left(trim(target_app_version),80),'connection_mode',target_connection_mode,'api_failure_count',target_api_failure_count,'api_max_latency_ms',target_api_max_latency_ms));
  else
    perform private.resolve_pos_operational_alert(target_organization_id,target_device_id,'API_OUTAGE');
  end if;
  stale_queue := target_queue_depth > 0 and coalesce(target_last_successful_sync_at, target_offline_since, now()) < now() - interval '15 minutes';
  if stale_queue then
    perform private.route_pos_operational_alert(target_organization_id,target_device_id,target_store_id,target_register_id,actor_employee_id,'STALE_QUEUE','CRITICAL',jsonb_build_object('app_version',left(trim(target_app_version),80),'queue_depth',target_queue_depth,'failed_count',target_failed_count,'conflict_count',target_conflict_count,'device_checkpoint',target_device_checkpoint,'server_checkpoint',target_server_checkpoint,'last_successful_sync_at',target_last_successful_sync_at));
  else
    perform private.resolve_pos_operational_alert(target_organization_id,target_device_id,'STALE_QUEUE');
  end if;
  return query select target_device_id, now();
end;
$$;

create or replace function public.list_pos_operational_alerts(target_organization_id uuid)
returns table (
  alert_id uuid, device_id uuid, store_id uuid, register_id uuid, alert_type text,
  severity text, status text, assigned_employee_name text, escalation_channel text,
  runbook_key text, diagnostic jsonb, occurrence_count integer,
  first_detected_at timestamptz, last_detected_at timestamptz, acknowledged_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_device_manager(target_organization_id);
  return query
  select alert.id,alert.device_id,alert.store_id,alert.register_id,alert.alert_type,
    alert.severity,alert.status,alert.assigned_employee_name,alert.escalation_channel,
    alert.runbook_key,alert.diagnostic,alert.occurrence_count,
    alert.first_detected_at,alert.last_detected_at,alert.acknowledged_at
  from public.pos_operational_alerts alert
  where alert.organization_id = target_organization_id
  order by (alert.status = 'OPEN') desc, alert.last_detected_at desc
  limit 200;
end;
$$;

create or replace function public.acknowledge_pos_operational_alert(target_organization_id uuid, target_alert_id uuid)
returns table (alert_id uuid, status text, acknowledged_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare actor_employee_id uuid;
begin
  actor_employee_id := private.require_device_manager(target_organization_id);
  update public.pos_operational_alerts alert
  set status='ACKNOWLEDGED',acknowledged_at=now(),acknowledged_by_employee_id=actor_employee_id,updated_at=now()
  where alert.organization_id=target_organization_id and alert.id=target_alert_id and alert.status='OPEN'
  returning alert.id,alert.status,alert.acknowledged_at into alert_id,status,acknowledged_at;
  if alert_id is null then raise exception 'The open operational alert was not found.' using errcode='P0002'; end if;
  perform private.write_audit_log(target_organization_id,'POS_OPERATIONAL_ALERT_ACKNOWLEDGED','observability.acknowledge',actor_employee_id,null,null,null,null,null,null,jsonb_build_object('alert_id',target_alert_id));
  return next;
end;
$$;

revoke all on function public.report_pos_device_sync_telemetry(uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,bigint,bigint,integer,integer,integer,timestamptz,bigint,timestamptz,timestamptz,bigint,timestamptz,integer,integer,integer,integer,integer,text,integer) from public, anon, authenticated, service_role, tindio_anon, tindio_authenticated, tindio_service;
grant execute on function public.report_pos_device_sync_telemetry(uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,bigint,bigint,integer,integer,integer,timestamptz,bigint,timestamptz,timestamptz,bigint,timestamptz,integer,integer,integer,integer,integer,text,integer) to tindio_authenticated;
revoke all on function public.list_pos_operational_alerts(uuid) from public, anon, authenticated, service_role, tindio_anon, tindio_authenticated, tindio_service;
grant execute on function public.list_pos_operational_alerts(uuid) to tindio_authenticated;
revoke all on function public.acknowledge_pos_operational_alert(uuid,uuid) from public, anon, authenticated, service_role, tindio_anon, tindio_authenticated, tindio_service;
grant execute on function public.acknowledge_pos_operational_alert(uuid,uuid) to tindio_authenticated;

notify pgrst, 'reload schema';
commit;
