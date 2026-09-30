begin;

do $$
declare
  required_role text;
begin
  foreach required_role in array array[
    'tindio_anon',
    'tindio_authenticated',
    'tindio_service',
    'anon',
    'authenticated',
    'service_role'
  ]
  loop
    if not exists (
      select 1
      from pg_catalog.pg_roles
      where rolname = required_role
    ) then
      raise exception
        'Required local database role % is unavailable.',
        required_role;
    end if;
  end loop;
end;
$$;

-- Supabase's local runtime manages these reserved provider roles. Their
-- inheritance is verified by the R4 certification runner rather than altered.

grant tindio_anon to anon;
grant tindio_authenticated to authenticated;
grant tindio_service to service_role;

commit;
