begin;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'tindio_anon'
  ) then
    raise exception
      'Canonical TINDIO role tindio_anon is unavailable. Install the canonical baseline before the Neon role adapter.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'tindio_authenticated'
  ) then
    raise exception
      'Canonical TINDIO role tindio_authenticated is unavailable. Install the canonical baseline before the Neon role adapter.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'tindio_service'
  ) then
    raise exception
      'Canonical TINDIO role tindio_service is unavailable. Install the canonical baseline before the Neon role adapter.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'authenticated'
  ) then
    create role authenticated nologin inherit;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'anon'
  ) then
    create role anon nologin inherit;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'service_role'
  ) then
    create role service_role nologin inherit;
  end if;
end;
$$;

alter role anon inherit;
alter role authenticated inherit;
alter role service_role inherit;

grant tindio_anon to anon;
grant tindio_authenticated to authenticated;
grant tindio_service to service_role;

commit;
