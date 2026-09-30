begin;

do $$
begin
  if to_regprocedure('auth.uid()') is null then
    raise exception 'Local/Supabase auth.uid() is unavailable.';
  end if;

  if to_regprocedure('auth.jwt()') is null then
    raise exception 'Local/Supabase auth.jwt() is unavailable.';
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
  select nullif(auth.uid()::text, '');
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
