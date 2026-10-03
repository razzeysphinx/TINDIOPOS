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

-- The canonical business function is provider-neutral, while the Supabase
-- local runtime owns auth.users. Recreate this provider bridge after every
-- canonical local installation so auth-user creation provisions the TINDIO
-- profile and stable identity link used by RLS and pgTAP fixtures.
drop trigger if exists auth_user_profile_sync on auth.users;

create trigger auth_user_profile_sync
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function private.sync_auth_user_profile();

-- Realtime is provider infrastructure. Keep its kitchen broadcast policy in
-- the local adapter so the canonical schema remains provider-neutral.
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists kitchen_display_receive_broadcasts on realtime.messages';
    execute $policy$
      create policy kitchen_display_receive_broadcasts
      on realtime.messages
      for select
      to authenticated
      using (
        realtime.messages.extension = 'broadcast'
        and (select private.can_access_kitchen_realtime_topic(realtime.topic()))
      )
    $policy$;
  end if;
end;
$$;

commit;
