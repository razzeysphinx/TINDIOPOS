begin;

do $$
begin
  if to_regprocedure('auth.user_id()') is null then
    raise exception
      'Neon auth.user_id() is unavailable. Enable Neon Data API external authentication.';
  end if;

  if to_regprocedure('auth.jwt()') is null then
    raise exception 'Neon auth.jwt() is unavailable.';
  end if;
end;
$$;

create or replace function private.current_identity_subject()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(auth.user_id()::text, '');
$$;

create or replace function private.current_identity_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(
    lower(coalesce(auth.jwt() ->> 'email', '')),
    ''
  );
$$;

revoke execute on function private.current_identity_subject()
from public, anon, authenticated, service_role;

revoke execute on function private.current_identity_email()
from public, anon, authenticated, service_role;

commit;
