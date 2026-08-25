-- Phase 17 repair: the prior Phase 16 archive routine checked only that an
-- export was prepared. The Phase 17 trigger is stricter and verifies a
-- completed delivery, so it becomes the single archive-freshness authority.

begin;

create or replace function private.manage_organization_lifecycle(
  target_organization_id uuid,
  target_action text,
  target_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_action text := upper(btrim(coalesce(target_action, '')));
  normalized_reason text := nullif(btrim(coalesce(target_reason, '')), '');
  organization_record public.organizations%rowtype;
  actor_employee_id uuid;
  rate_limit_result jsonb;
begin
  if not private.has_organization_lifecycle_access(target_organization_id) then
    raise exception 'Only an organization owner can change this lifecycle.' using errcode = '42501';
  end if;

  rate_limit_result := private.consume_organization_rate_limit(
    target_organization_id,
    'organization.lifecycle'
  );

  if not coalesce((rate_limit_result ->> 'allowed')::boolean, false) then
    return rate_limit_result;
  end if;

  select organization.*
  into organization_record
  from public.organizations organization
  where organization.id = target_organization_id
  for update;

  if not found then
    raise exception 'Organization was not found.' using errcode = 'P0002';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active'
  order by employee.created_at
  limit 1;

  if normalized_action in ('SUSPEND', 'REQUEST_ARCHIVE')
    and (normalized_reason is null or char_length(normalized_reason) not between 3 and 500) then
    raise exception 'Provide a reason between 3 and 500 characters.' using errcode = '22023';
  end if;

  if organization_record.status = 'archived' and normalized_action <> 'ARCHIVE' then
    raise exception 'Archived organizations are retained and cannot be reactivated.' using errcode = '22023';
  end if;

  case normalized_action
    when 'SUSPEND' then
      if organization_record.status = 'suspended' then
        raise exception 'This organization is already suspended.' using errcode = '22023';
      end if;

      perform private.write_audit_log(
        target_organization_id, 'ORGANIZATION_SUSPENDED', 'organization.archive', actor_employee_id,
        null, null, null, null, null, normalized_reason,
        jsonb_build_object('previous_status', organization_record.status)
      );

      update public.organizations organization
      set status = 'suspended',
          suspended_at = now(),
          suspension_reason = normalized_reason
      where organization.id = target_organization_id;

    when 'RESUME' then
      if organization_record.status <> 'suspended' then
        raise exception 'Only a suspended organization can be resumed.' using errcode = '22023';
      end if;

      update public.organizations organization
      set status = 'active',
          suspended_at = null,
          suspension_reason = null
      where organization.id = target_organization_id;

      perform private.write_audit_log(
        target_organization_id, 'ORGANIZATION_RESUMED', 'organization.archive', actor_employee_id,
        null, null, null, null, null, null,
        jsonb_build_object('previous_status', organization_record.status)
      );

    when 'REQUEST_ARCHIVE' then
      if organization_record.archive_requested_at is not null then
        raise exception 'An archive request is already open for this organization.' using errcode = '22023';
      end if;

      update public.organizations organization
      set archive_requested_at = clock_timestamp(),
          archive_requested_by_employee_id = actor_employee_id
      where organization.id = target_organization_id;

      perform private.write_audit_log(
        target_organization_id, 'ORGANIZATION_ARCHIVE_REQUESTED', 'organization.lifecycle', actor_employee_id,
        null, null, null, null, null, normalized_reason,
        jsonb_build_object('status', organization_record.status)
      );

    when 'CANCEL_ARCHIVE' then
      if organization_record.archive_requested_at is null then
        raise exception 'There is no archive request to cancel.' using errcode = '22023';
      end if;

      update public.organizations organization
      set archive_requested_at = null,
          archive_requested_by_employee_id = null
      where organization.id = target_organization_id;

      perform private.write_audit_log(
        target_organization_id, 'ORGANIZATION_ARCHIVE_CANCELLED', 'organization.lifecycle', actor_employee_id,
        null, null, null, null, null, null,
        '{}'::jsonb
      );

    when 'ARCHIVE' then
      if organization_record.archive_requested_at is null then
        raise exception 'Request an archive and download an export before archiving this organization.' using errcode = '22023';
      end if;

      -- organizations_archive_export_delivered verifies that a fresh export
      -- was delivered after this request before this status can be changed.
      perform private.write_audit_log(
        target_organization_id, 'ORGANIZATION_ARCHIVED', 'organization.archive', actor_employee_id,
        null, null, null, null, null, null,
        jsonb_build_object('archive_requested_at', organization_record.archive_requested_at)
      );

      update public.organizations organization
      set status = 'archived',
          archived_at = now(),
          suspended_at = null,
          suspension_reason = null
      where organization.id = target_organization_id;

    else
      raise exception 'Unsupported organization lifecycle action.' using errcode = '22023';
  end case;

  select organization.*
  into organization_record
  from public.organizations organization
  where organization.id = target_organization_id;

  return rate_limit_result || jsonb_build_object(
    'status', organization_record.status,
    'suspended_at', organization_record.suspended_at,
    'archive_requested_at', organization_record.archive_requested_at,
    'archived_at', organization_record.archived_at
  );
end;
$$;

comment on function public.manage_organization_lifecycle(uuid, text, text) is 'Non-destructive organization suspension and archive workflow. Archiving requires a recorded request plus a newly delivered tenant export; physical tenant deletion is intentionally unsupported.';

notify pgrst, 'reload schema';

commit;
