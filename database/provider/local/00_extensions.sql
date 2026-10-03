begin;

-- A fresh local Supabase database does not guarantee that the contrib
-- extensions used by the canonical TINDIO baseline are installed. Keep this
-- provider-owned bootstrap ahead of the canonical schema, mirroring the
-- isolated Neon installer without putting provider setup in the baseline.
create schema if not exists extensions;

create extension if not exists pgcrypto
  with schema extensions;

create extension if not exists pg_trgm
  with schema extensions;

do $$
begin
  if to_regprocedure('extensions.crypt(text,text)') is null then
    raise exception
      'TINDIO local bootstrap requires extensions.crypt(text,text).';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_opclass opclass
    join pg_catalog.pg_namespace namespace_record
      on namespace_record.oid = opclass.opcnamespace
    join pg_catalog.pg_am access_method
      on access_method.oid = opclass.opcmethod
    where namespace_record.nspname = 'extensions'
      and opclass.opcname = 'gin_trgm_ops'
      and access_method.amname = 'gin'
  ) then
    raise exception
      'TINDIO local bootstrap requires extensions.gin_trgm_ops for GIN.';
  end if;
end;
$$;

commit;
