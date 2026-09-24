begin;

create or replace function public.get_pos_live_state_v2(
  target_organization_id uuid,
  target_store_id uuid default null,
  target_register_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_profile_id uuid;
  selected_employee_id uuid;

  permissions text[] := '{}'::text[];
  effective_store_ids uuid[] := '{}'::uuid[];

  time_clock_enabled boolean := false;
  customer_display_enabled boolean := false;
  inventory_enabled boolean := false;
  transfers_enabled boolean := false;
  open_tickets_feature_enabled boolean := false;
  incoming_transfers_enabled boolean := false;
  open_tickets_enabled boolean := false;
  ticket_assignees_enabled boolean := false;
  active_shift_matches_target boolean := false;

  time_clock_entry_json jsonb := 'null'::jsonb;
  customer_display_sessions_json jsonb := '[]'::jsonb;
  incoming_transfers_raw_json jsonb := '[]'::jsonb;
  open_tickets_raw_json jsonb := '[]'::jsonb;
  ticket_assignees_json jsonb := '[]'::jsonb;
begin
  actor_profile_id := private.current_profile_id();

  if actor_profile_id is null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'IDENTITY_UNMAPPED'
    );
  end if;

  select employee.id
  into selected_employee_id
  from public.employees employee
  where employee.profile_id = actor_profile_id
    and employee.organization_id = target_organization_id
    and employee.status = 'active'
  order by employee.created_at, employee.id
  limit 1;

  if selected_employee_id is null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'ORGANIZATION_FORBIDDEN'
    );
  end if;

  select
    coalesce(
      array_agg(
        distinct role_permission.permission_code
        order by role_permission.permission_code
      ),
      '{}'::text[]
    )
  into permissions
  from public.employee_roles employee_role
  join public.role_permissions role_permission
    on role_permission.organization_id = employee_role.organization_id
    and role_permission.role_id = employee_role.role_id
  where employee_role.organization_id = target_organization_id
    and employee_role.employee_id = selected_employee_id;

  if not (
    'pos.access' = any(permissions)
    and 'sales.create' = any(permissions)
  ) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'POS_ACCESS_FORBIDDEN'
    );
  end if;

  if 'stores.manage' = any(permissions) then
    select
      coalesce(
        array_agg(store.id order by store.created_at, store.id),
        '{}'::uuid[]
      )
    into effective_store_ids
    from public.stores store
    where store.organization_id = target_organization_id
      and store.is_active;
  else
    select
      coalesce(
        array_agg(distinct store.id order by store.id),
        '{}'::uuid[]
      )
    into effective_store_ids
    from public.employee_stores assignment
    join public.stores store
      on store.organization_id = assignment.organization_id
      and store.id = assignment.store_id
      and store.is_active
    where assignment.organization_id = target_organization_id
      and assignment.employee_id = selected_employee_id;
  end if;

  if (
    target_store_id is not null
    and not target_store_id = any(effective_store_ids)
  ) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'STORE_FORBIDDEN'
    );
  end if;

  if target_register_id is not null then
    if target_store_id is null then
      return jsonb_build_object(
        'ok', false,
        'reason', 'STORE_REQUIRED_FOR_REGISTER'
      );
    end if;

    if not exists (
      select 1
      from public.registers register
      where register.organization_id = target_organization_id
        and register.id = target_register_id
        and register.store_id = target_store_id
        and register.is_active
    ) then
      return jsonb_build_object(
        'ok', false,
        'reason', 'REGISTER_FORBIDDEN'
      );
    end if;
  end if;

  select
    coalesce(
      bool_or(feature.is_enabled)
        filter (
          where feature.feature_key = 'time_clock'
        ),
      false
    ),
    coalesce(
      bool_or(feature.is_enabled)
        filter (
          where feature.feature_key = 'customer_display'
        ),
      false
    ),
    coalesce(
      bool_or(feature.is_enabled)
        filter (
          where feature.feature_key = 'inventory'
        ),
      false
    ),
    coalesce(
      bool_or(feature.is_enabled)
        filter (
          where feature.feature_key = 'transfers'
        ),
      false
    ),
    coalesce(
      bool_or(feature.is_enabled)
        filter (
          where feature.feature_key = 'open_tickets'
        ),
      false
    )
  into
    time_clock_enabled,
    customer_display_enabled,
    inventory_enabled,
    transfers_enabled,
    open_tickets_feature_enabled
  from public.organization_features feature
  where feature.organization_id = target_organization_id;

  incoming_transfers_enabled :=
    inventory_enabled
    and transfers_enabled
    and 'inventory.transfer.receive' = any(permissions);

  open_tickets_enabled :=
    open_tickets_feature_enabled
    and 'tickets.manage' = any(permissions);

  ticket_assignees_enabled :=
    open_tickets_enabled
    and 'employees.manage' = any(permissions);

  if time_clock_enabled then
    select
      jsonb_build_object(
        'id', entry.entry_id,
        'employeeId', selected_employee_id,
        'employeeName',
          coalesce(
            nullif(btrim(profile.full_name), ''),
            profile.email,
            employee.employee_number
          ),
        'storeId', entry.store_id,
        'storeName', store.name,
        'clockedInAt', entry.clocked_in_at
      )
    into time_clock_entry_json
    from public.get_current_time_clock_entry(
      target_organization_id
    ) entry
    join public.stores store
      on store.organization_id = target_organization_id
      and store.id = entry.store_id
    join public.employees employee
      on employee.organization_id = target_organization_id
      and employee.id = selected_employee_id
    left join public.profiles profile
      on profile.id = employee.profile_id
    where entry.store_id = any(effective_store_ids)
    order by entry.clocked_in_at desc, entry.entry_id
    limit 1;
  end if;

  if customer_display_enabled then
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'sessionId', session.session_id,
            'registerId', session.register_id,
            'realtimeTopic', session.realtime_topic
          )
          order by session.register_id, session.session_id
        ),
        '[]'::jsonb
      )
    into customer_display_sessions_json
    from public.get_pos_customer_display_sessions_with_ids(
      target_organization_id
    ) session
    join public.registers register
      on register.organization_id = target_organization_id
      and register.id = session.register_id
      and register.is_active
    where register.store_id = any(effective_store_ids);
  end if;

  if incoming_transfers_enabled then
    select
      coalesce(
        jsonb_agg(
          to_jsonb(transfer)
          order by transfer.transfer_number desc, transfer.transfer_id
        ),
        '[]'::jsonb
      )
    into incoming_transfers_raw_json
    from public.get_pos_incoming_stock_transfers(
      target_organization_id
    ) transfer
    where transfer.destination_store_id = any(effective_store_ids);
  end if;

  if (
    open_tickets_enabled
    and target_store_id is not null
    and target_register_id is not null
  ) then
    select exists (
      select 1
      from public.shifts shift
      where shift.organization_id = target_organization_id
        and shift.opened_by_employee_id = selected_employee_id
        and shift.store_id = target_store_id
        and shift.register_id = target_register_id
        and shift.status = 'open'
    )
    into active_shift_matches_target;

    if active_shift_matches_target then
      select
        coalesce(
          jsonb_agg(
            to_jsonb(ticket)
            order by ticket.updated_at desc, ticket.ticket_id
          ),
          '[]'::jsonb
        )
      into open_tickets_raw_json
      from public.get_pos_open_tickets(
        target_organization_id,
        target_store_id,
        target_register_id
      ) ticket;
    end if;
  end if;

  if (
    ticket_assignees_enabled
    and target_store_id is not null
  ) then
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', assignee.employee_id,
            'fullName', assignee.full_name
          )
          order by assignee.full_name, assignee.employee_id
        ),
        '[]'::jsonb
      )
    into ticket_assignees_json
    from public.get_pos_ticket_assignees(
      target_organization_id,
      target_store_id
    ) assignee;
  end if;

  return jsonb_build_object(
    'ok', true,
    'organizationId', target_organization_id,
    'storeId', target_store_id,
    'registerId', target_register_id,
    'live', jsonb_build_object(
      'timeClockEntry', time_clock_entry_json,
      'customerDisplaySessions', customer_display_sessions_json,
      'canReceiveIncomingTransfers', incoming_transfers_enabled,
      'incomingTransfersRaw', incoming_transfers_raw_json,
      'openTicketsRaw', open_tickets_raw_json,
      'ticketAssignees', ticket_assignees_json
    )
  );
end;
$$;

revoke all
on function public.get_pos_live_state_v2(uuid, uuid, uuid)
from public, anon, service_role;

grant execute
on function public.get_pos_live_state_v2(uuid, uuid, uuid)
to authenticated;

comment on function public.get_pos_live_state_v2(uuid, uuid, uuid)
is
'POS V2 read-only live-state bundle. Resolves provider-neutral identity, active employee membership, POS permissions, organization features, and effective store/register scope server-side. Missing shifts return empty live ticket data rather than failing startup.';

notify pgrst, 'reload schema';

commit;
