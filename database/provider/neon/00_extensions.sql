begin;

-- TINDIO's historical PostgreSQL functions use Supabase's conventional
-- `extensions` schema for pgcrypto.
--
-- Keep the certified function bodies unchanged and reproduce that standard
-- PostgreSQL extension surface on the Neon provider.

create schema if not exists extensions;

create extension if not exists pgcrypto
  with schema extensions;

do $$
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
end;
$$;

commit;
