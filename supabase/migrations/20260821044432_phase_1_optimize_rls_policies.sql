-- Keep the invitation recipient JWT lookup in an init plan so PostgreSQL
-- evaluates it once per statement rather than once per candidate row.
drop policy if exists employee_invitations_select_authorized
on public.employee_invitations;

create policy employee_invitations_select_authorized
on public.employee_invitations for select
to authenticated
using (
  (select private.has_permission(organization_id, 'employees.manage'))
  or (
    accepted_at is null
    and revoked_at is null
    and expires_at > now()
    and lower(email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  )
);

-- can_view_employee_profile already includes the caller's own profile, so a
-- single policy preserves the same access model without evaluating two
-- permissive SELECT policies for every row.
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_select_managed_employees on public.profiles;

create policy profiles_select_authorized
on public.profiles for select
to authenticated
using ((select private.can_view_employee_profile(id)));
