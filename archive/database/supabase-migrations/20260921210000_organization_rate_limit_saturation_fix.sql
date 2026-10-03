begin;

create or replace function private.consume_organization_rate_limit(
  target_organization_id uuid,
  target_action_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_action_code text :=
    lower(btrim(coalesce(target_action_code, '')));

  configured_limit integer;

  current_window_start timestamptz :=
    date_trunc('hour', clock_timestamp());

  current_window_ends_at timestamptz;

  observed_request_count integer;

  request_was_allowed boolean := false;
begin
  case normalized_action_code
    when 'organization.export' then
      configured_limit := 3;

      if not private.has_organization_export_access(
        target_organization_id
      ) then
        raise exception
          'You do not have permission to export this organization.'
          using errcode = '42501';
      end if;

    when 'organization.lifecycle' then
      configured_limit := 10;

      if not private.has_organization_lifecycle_access(
        target_organization_id
      ) then
        raise exception
          'Only an organization owner can change this lifecycle.'
          using errcode = '42501';
      end if;

    when 'organization.recovery_drill' then
      configured_limit := 10;

      if not private.has_organization_recovery_manage_access(
        target_organization_id
      ) then
        raise exception
          'Only an owner can record a recovery drill.'
          using errcode = '42501';
      end if;

    else
      raise exception
        'Unsupported organization rate-limit action.'
        using errcode = '22023';
  end case;

  current_window_ends_at :=
    current_window_start + interval '1 hour';

  delete from public.organization_rate_limit_windows rate_window
  where rate_window.window_started_at
    < current_window_start - interval '2 days';

  observed_request_count := null;

  insert into public.organization_rate_limit_windows (
    organization_id,
    profile_id,
    action_code,
    window_started_at,
    request_count
  )
  values (
    target_organization_id,
    (select auth.uid()),
    normalized_action_code,
    current_window_start,
    1
  )
  on conflict (
    organization_id,
    profile_id,
    action_code,
    window_started_at
  )
  do update
    set
      request_count =
        public.organization_rate_limit_windows.request_count + 1,
      updated_at = clock_timestamp()
  where public.organization_rate_limit_windows.request_count
    < configured_limit
  returning request_count
  into observed_request_count;

  request_was_allowed :=
    observed_request_count is not null;

  if not request_was_allowed then
    select rate_window.request_count
    into observed_request_count
    from public.organization_rate_limit_windows rate_window
    where rate_window.organization_id = target_organization_id
      and rate_window.profile_id = (select auth.uid())
      and rate_window.action_code = normalized_action_code
      and rate_window.window_started_at = current_window_start;

    if observed_request_count is null then
      raise exception
        'The organization rate-limit window could not be resolved.'
        using errcode = 'P0001';
    end if;
  end if;

  return jsonb_build_object(
    'allowed',
      request_was_allowed,

    'limit',
      configured_limit,

    'remaining',
      greatest(
        configured_limit - observed_request_count,
        0
      ),

    'retry_after_seconds',
      greatest(
        floor(
          extract(
            epoch
            from (
              current_window_ends_at - clock_timestamp()
            )
          )
        )::integer,
        0
      )
  );
end;
$function$;

revoke execute
on function private.consume_organization_rate_limit(uuid,text)
from public, anon, authenticated, service_role;

comment on function private.consume_organization_rate_limit(uuid,text)
is
  'Atomically consumes an organization action rate-limit slot. A request is allowed only when its capped INSERT/UPDATE returns a row; reloading the saturated count never grants another slot.';

notify pgrst, 'reload schema';

commit;
