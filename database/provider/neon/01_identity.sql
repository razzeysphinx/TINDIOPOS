begin;

-- Neon Data API external-auth mode exposes the verified JWT through the
-- pg_session_jwt auth helpers.
--
-- TINDIO deliberately consumes the provider-owned helper surface instead of
-- replacing extension-owned functions.

do $$
begin
  if to_regprocedure(
    'auth.user_id()'
  ) is null then
    raise exception
      'Neon identity helper auth.user_id() is unavailable. Enable Neon Data API external authentication before installing the TINDIO identity adapter.';
  end if;

  if to_regprocedure(
    'auth.uid()'
  ) is null then
    raise exception
      'Neon identity helper auth.uid() is unavailable.';
  end if;

  if to_regprocedure(
    'auth.jwt()'
  ) is null then
    raise exception
      'Neon identity helper auth.jwt() is unavailable.';
  end if;

  if to_regprocedure(
    'auth.session()'
  ) is null then
    raise exception
      'Neon identity helper auth.session() is unavailable.';
  end if;
end;
$$;

-- TINDIO business authorization does not depend directly on the external
-- provider. It resolves the verified JWT subject through this TINDIO-owned
-- provider boundary, then maps that subject through private.identity_links.

create or replace function private.current_identity_subject()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(
    auth.user_id()::text,
    ''
  );
$$;

revoke execute
on function
  private.current_identity_subject()
from public, anon, authenticated, service_role;

commit;
