-- Phase 17 repair: archive freshness must use real event time, not the
-- transaction-start time exposed by now(). This matters for a recovery drill
-- or verification operation that performs more than one step in one database
-- transaction.

begin;

create or replace function private.record_archive_request_time()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.archive_requested_at is not null and old.archive_requested_at is null then
    new.archive_requested_at := clock_timestamp();
  end if;

  return new;
end;
$$;

drop trigger if exists organizations_record_archive_request_time on public.organizations;
create trigger organizations_record_archive_request_time
before update of archive_requested_at on public.organizations
for each row execute function private.record_archive_request_time();

create or replace function private.complete_organization_export(
  target_export_session_id uuid,
  target_record_count integer,
  target_manifest jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  export_session public.organization_export_sessions%rowtype;
  actor_employee_id uuid;
  delivery_completed_at timestamptz := clock_timestamp();
begin
  if target_record_count not between 1 and 50000000
    or jsonb_typeof(target_manifest) <> 'object'
    or not (target_manifest ? 'format')
    or not (target_manifest ? 'sections') then
    raise exception 'Export delivery details are invalid.' using errcode = '22023';
  end if;

  select session.*
  into export_session
  from public.organization_export_sessions session
  where session.id = target_export_session_id
    and session.profile_id = (select auth.uid())
    and session.expires_at > now()
  for update;

  if not found then
    raise exception 'The organization export session is missing or has expired.' using errcode = '42501';
  end if;

  if not private.has_organization_export_access(export_session.organization_id) then
    raise exception 'You do not have permission to export this organization.' using errcode = '42501';
  end if;

  if export_session.delivered_at is not null then
    return jsonb_build_object(
      'export_session_id', export_session.id,
      'delivered_at', export_session.delivered_at,
      'record_count', export_session.delivered_record_count,
      'was_replayed', true
    );
  end if;

  update public.organization_export_sessions session
  set
    delivered_at = delivery_completed_at,
    delivered_record_count = target_record_count,
    delivery_manifest = target_manifest
  where session.id = export_session.id;

  actor_employee_id := private.current_organization_member_employee_id(export_session.organization_id);

  perform private.write_audit_log(
    export_session.organization_id,
    'ORGANIZATION_EXPORT_DELIVERED',
    'organization.export',
    actor_employee_id,
    null,
    null,
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'export_session_id', export_session.id,
      'record_count', target_record_count,
      'format', target_manifest ->> 'format'
    )
  );

  return jsonb_build_object(
    'export_session_id', export_session.id,
    'delivered_at', delivery_completed_at,
    'record_count', target_record_count,
    'was_replayed', false
  );
end;
$$;

revoke execute on function private.record_archive_request_time() from public, anon, authenticated, service_role;

comment on function private.record_archive_request_time() is 'Uses a real wall-clock archive-request timestamp so a freshly delivered export can be distinguished from an older one inside long transactions.';

notify pgrst, 'reload schema';

commit;
