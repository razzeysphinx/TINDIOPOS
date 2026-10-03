-- TINDIO Neon Recovery R1 gate repair.
--
-- The open_tickets RLS policy invokes:
--
--   private.has_active_pos_shift_access(uuid, uuid, uuid)
--
-- The provider-neutral POS repair intentionally made this helper a narrow,
-- SECURITY DEFINER boolean predicate but also revoked authenticated EXECUTE.
-- PostgreSQL policy evaluation still requires the invoking role to be allowed
-- to execute the function.
--
-- This migration restores ONLY the minimum privilege required by the
-- authenticated-only RLS policy.
--
-- It does not expose financial values.
-- It does not bypass tenant/store/employee/shift validation.
-- It does not grant anonymous/public access.

begin;

do $$
begin
  if to_regprocedure(
    'private.has_active_pos_shift_access(uuid,uuid,uuid)'
  ) is null then
    raise exception
      'private.has_active_pos_shift_access(uuid,uuid,uuid) is missing.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'open_tickets'
      and policy.policyname = 'open_tickets_select_active_shift_owner'
      and coalesce(
        policy.qual,
        ''
      ) like '%has_active_pos_shift_access%'
  ) then
    raise exception
      'Expected open_tickets active-shift RLS policy is missing.';
  end if;
end;
$$;

revoke execute
on function private.has_active_pos_shift_access(
  uuid,
  uuid,
  uuid
)
from
  public,
  anon,
  service_role;

grant execute
on function private.has_active_pos_shift_access(
  uuid,
  uuid,
  uuid
)
to authenticated;

comment on function private.has_active_pos_shift_access(
  uuid,
  uuid,
  uuid
)
is
'RLS-safe active POS drawer predicate. EXECUTE is intentionally limited to authenticated because open_tickets RLS evaluates this helper for authenticated users. The function remains SECURITY DEFINER and independently validates TINDIO identity, sales permission, store scope, employee status, register scope, and owned open-shift state.';

commit;
