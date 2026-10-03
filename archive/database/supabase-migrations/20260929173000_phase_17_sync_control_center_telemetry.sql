-- TINDIO Phase 17: tenant/store-scoped POS sync telemetry.
begin;

create table public.pos_device_sync_telemetry (
  organization_id uuid not null,
  device_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  employee_id uuid not null,
  employee_name_snapshot text not null,
  connection_mode text not null check (
    connection_mode in (
      'CLOUD_ONLINE',
      'STORE_LOCAL',
      'DEVICE_ISOLATED',
      'RECOVERING',
      'SYNC_REVIEW'
    )
  ),
  app_version text not null,
  last_heartbeat_at timestamptz not null default now(),
  last_successful_sync_at timestamptz,
  device_checkpoint bigint not null default 0 check (device_checkpoint >= 0),
  server_checkpoint bigint not null default 0 check (server_checkpoint >= 0),
  queue_depth integer not null default 0 check (queue_depth >= 0),
  conflict_count integer not null default 0 check (conflict_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  offline_since timestamptz,
  updated_at timestamptz not null default now(),
  primary key (organization_id, device_id),
  constraint pos_device_sync_telemetry_device_org_fkey
    foreign key (device_id, organization_id)
    references public.pos_devices (id, organization_id)
    on delete cascade,
  constraint pos_device_sync_telemetry_store_org_fkey
    foreign key (store_id, organization_id)
    references public.stores (id, organization_id)
    on delete cascade,
  constraint pos_device_sync_telemetry_register_org_fkey
    foreign key (register_id, organization_id)
    references public.registers (id, organization_id)
    on delete cascade
);

create index pos_device_sync_telemetry_org_store_idx
  on public.pos_device_sync_telemetry (
    organization_id,
    store_id,
    last_heartbeat_at desc
  );

create index pos_device_sync_telemetry_attention_idx
  on public.pos_device_sync_telemetry (
    organization_id,
    connection_mode,
    queue_depth,
    conflict_count,
    failed_count
  );

alter table public.pos_device_sync_telemetry
  enable row level security;

revoke all on table public.pos_device_sync_telemetry
  from public, anon, authenticated, service_role;

grant select on table public.pos_device_sync_telemetry
  to authenticated;

create policy pos_device_sync_telemetry_manager_select
on public.pos_device_sync_telemetry
for select
to authenticated
using (
  private.current_employee_id(organization_id) is not null
  and private.has_permission(organization_id, 'devices.manage')
);

create or replace function public.report_pos_device_sync_telemetry(
  target_organization_id uuid,
  target_device_id uuid,
  target_store_id uuid,
  target_register_id uuid,
  target_employee_id uuid,
  target_employee_name text,
  target_connection_mode text,
  target_app_version text,
  target_last_successful_sync_at timestamptz,
  target_device_checkpoint bigint,
  target_server_checkpoint bigint,
  target_queue_depth integer,
  target_conflict_count integer,
  target_failed_count integer,
  target_offline_since timestamptz
)
returns table (
  device_id uuid,
  heartbeat_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  verified_store_id uuid;
  verified_register_id uuid;
begin
  actor_employee_id :=
    private.current_employee_id(
      target_organization_id
    );

  if actor_employee_id is null
    or actor_employee_id <> target_employee_id
    or not private.has_permission(
      target_organization_id,
      'pos.access'
    )
  then
    raise exception
      'POS telemetry requires an active POS employee.'
      using errcode = '42501';
  end if;

  if target_connection_mode not in (
    'CLOUD_ONLINE',
    'STORE_LOCAL',
    'DEVICE_ISOLATED',
    'RECOVERING',
    'SYNC_REVIEW'
  ) then
    raise exception
      'Invalid POS connection mode.'
      using errcode = '23514';
  end if;

  if target_device_checkpoint < 0
    or target_server_checkpoint < 0
    or target_queue_depth < 0
    or target_conflict_count < 0
    or target_failed_count < 0
  then
    raise exception
      'Invalid POS telemetry counters.'
      using errcode = '23514';
  end if;

  select
    device.store_id,
    device.register_id
  into
    verified_store_id,
    verified_register_id
  from public.pos_devices device
  where
    device.organization_id =
      target_organization_id
    and device.id = target_device_id
    and device.status = 'active';

  if verified_store_id is null
    or verified_store_id <> target_store_id
    or verified_register_id <> target_register_id
  then
    raise exception
      'POS device telemetry binding mismatch.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.employee_stores assignment
    where
      assignment.organization_id =
        target_organization_id
      and assignment.employee_id =
        actor_employee_id
      and assignment.store_id =
        target_store_id
  ) then
    raise exception
      'POS employee is not assigned to this device store.'
      using errcode = '42501';
  end if;

  insert into public.pos_device_sync_telemetry (
    organization_id,
    device_id,
    store_id,
    register_id,
    employee_id,
    employee_name_snapshot,
    connection_mode,
    app_version,
    last_heartbeat_at,
    last_successful_sync_at,
    device_checkpoint,
    server_checkpoint,
    queue_depth,
    conflict_count,
    failed_count,
    offline_since,
    updated_at
  )
  values (
    target_organization_id,
    target_device_id,
    target_store_id,
    target_register_id,
    target_employee_id,
    left(trim(target_employee_name), 160),
    target_connection_mode,
    left(trim(target_app_version), 80),
    now(),
    target_last_successful_sync_at,
    target_device_checkpoint,
    target_server_checkpoint,
    target_queue_depth,
    target_conflict_count,
    target_failed_count,
    target_offline_since,
    now()
  )
  on conflict (
    organization_id,
    device_id
  )
  do update set
    store_id = excluded.store_id,
    register_id = excluded.register_id,
    employee_id = excluded.employee_id,
    employee_name_snapshot =
      excluded.employee_name_snapshot,
    connection_mode =
      excluded.connection_mode,
    app_version = excluded.app_version,
    last_heartbeat_at =
      excluded.last_heartbeat_at,
    last_successful_sync_at =
      excluded.last_successful_sync_at,
    device_checkpoint =
      excluded.device_checkpoint,
    server_checkpoint =
      excluded.server_checkpoint,
    queue_depth =
      excluded.queue_depth,
    conflict_count =
      excluded.conflict_count,
    failed_count =
      excluded.failed_count,
    offline_since =
      excluded.offline_since,
    updated_at = now();

  return query
  select
    target_device_id,
    now();
end;
$$;

revoke execute on function public.report_pos_device_sync_telemetry(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  timestamptz,
  bigint,
  bigint,
  integer,
  integer,
  integer,
  timestamptz
) from public, anon, service_role;

grant execute on function public.report_pos_device_sync_telemetry(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  timestamptz,
  bigint,
  bigint,
  integer,
  integer,
  integer,
  timestamptz
) to authenticated;

commit;
