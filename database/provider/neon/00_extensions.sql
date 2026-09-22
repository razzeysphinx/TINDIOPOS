begin;

-- TINDIO historically uses Supabase's conventional `extensions` schema
-- for PostgreSQL contrib extensions.
--
-- Reproduce that same PostgreSQL surface on Neon so existing certified
-- functions, indexes, and operator classes remain unchanged.

create schema if not exists extensions;

-- Cryptographic hashing / PIN / device-secret primitives.
create extension if not exists pgcrypto
  with schema extensions;

-- Trigram search support used by GIN/GiST text-search indexes.
create extension if not exists pg_trgm
  with schema extensions;

do $$
declare
  trigram_gin_exists boolean;
  trigram_gist_exists boolean;
begin
  if to_regprocedure(
    'extensions.crypt(text,text)'
  ) is null then
    raise exception
      'TINDIO Neon bootstrap requires extensions.crypt(text,text).';
  end if;

  if to_regprocedure(
    'extensions.gen_salt(text,integer)'
  ) is null then
    raise exception
      'TINDIO Neon bootstrap requires extensions.gen_salt(text,integer).';
  end if;

  if to_regprocedure(
    'extensions.digest(text,text)'
  ) is null then
    raise exception
      'TINDIO Neon bootstrap requires extensions.digest(text,text).';
  end if;

  select exists (
    select 1
    from pg_catalog.pg_opclass opclass
    join pg_catalog.pg_namespace namespace_record
      on namespace_record.oid =
        opclass.opcnamespace
    join pg_catalog.pg_am access_method
      on access_method.oid =
        opclass.opcmethod
    where namespace_record.nspname =
      'extensions'
      and opclass.opcname =
        'gin_trgm_ops'
      and access_method.amname =
        'gin'
  )
  into trigram_gin_exists;

  if not trigram_gin_exists then
    raise exception
      'TINDIO Neon bootstrap requires extensions.gin_trgm_ops for GIN.';
  end if;

  select exists (
    select 1
    from pg_catalog.pg_opclass opclass
    join pg_catalog.pg_namespace namespace_record
      on namespace_record.oid =
        opclass.opcnamespace
    join pg_catalog.pg_am access_method
      on access_method.oid =
        opclass.opcmethod
    where namespace_record.nspname =
      'extensions'
      and opclass.opcname =
        'gist_trgm_ops'
      and access_method.amname =
        'gist'
  )
  into trigram_gist_exists;

  if not trigram_gist_exists then
    raise exception
      'TINDIO Neon bootstrap requires extensions.gist_trgm_ops for GiST.';
  end if;
end;
$$;

commit;
