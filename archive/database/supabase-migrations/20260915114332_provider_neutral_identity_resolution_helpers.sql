-- TINDIO R3.3/R3.4: provider-neutral identity resolution helpers.
--
-- This migration introduces the authentication-provider adapter boundary.
--
-- Existing RLS policies, RBAC functions, profile ownership, employee
-- relationships, organization ownership, application authentication, and
-- business behavior remain unchanged in this packet.
--
-- Provider-specific authentication knowledge must begin concentrating here
-- rather than spreading further through TINDIO business logic.

create or replace function private.current_identity_subject()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid())::text;
$$;

revoke execute
on function private.current_identity_subject()
from public, anon, authenticated, service_role;

create or replace function private.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select identity_link.profile_id
  from private.identity_links identity_link
  where identity_link.provider = 'supabase'
    and identity_link.provider_subject =
      (select private.current_identity_subject());
$$;

revoke execute
on function private.current_profile_id()
from public, anon, authenticated, service_role;
