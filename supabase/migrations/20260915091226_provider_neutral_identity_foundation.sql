-- TINDIO R3.2: provider-neutral identity foundation.
--
-- This migration is intentionally additive.
-- Existing Supabase authentication, profile IDs, employee relationships,
-- organization ownership, RLS policies, and RBAC behavior remain unchanged.
--
-- The purpose of this bridge is to separate external authentication identity
-- from permanent TINDIO-owned profile identity before later R3 migrations.

create table private.identity_links (
  provider text not null,
  provider_subject text not null,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint identity_links_pkey
    primary key (provider, provider_subject),

  constraint identity_links_provider_profile_unique
    unique (provider, profile_id),

  constraint identity_links_provider_length
    check (char_length(btrim(provider)) between 1 and 80),

  constraint identity_links_provider_subject_length
    check (char_length(btrim(provider_subject)) between 1 and 512)
);

create index identity_links_profile_id_idx
  on private.identity_links (profile_id);

revoke all on table private.identity_links
from public, anon, authenticated, service_role;

create trigger identity_links_set_updated_at
before update on private.identity_links
for each row execute function private.set_updated_at();

-- Transitional R3 backfill.
--
-- During this phase profiles.id is still constrained to auth.users.id.
-- Record that relationship explicitly instead of requiring future business
-- logic to infer identity equality.

insert into private.identity_links (
  provider,
  provider_subject,
  profile_id
)
select
  'supabase',
  auth_user.id::text,
  profile.id
from auth.users auth_user
join public.profiles profile
  on profile.id = auth_user.id;

-- Fail the migration instead of silently accepting an incomplete or
-- contradictory identity bridge.

do $$
begin
  if exists (
    select 1
    from auth.users auth_user
    left join public.profiles profile
      on profile.id = auth_user.id
    where profile.id is null
  ) then
    raise exception
      'R3 identity foundation validation failed: auth user without TINDIO profile';
  end if;

  if exists (
    select 1
    from public.profiles profile
    left join private.identity_links identity_link
      on identity_link.provider = 'supabase'
     and identity_link.provider_subject = profile.id::text
     and identity_link.profile_id = profile.id
    where identity_link.profile_id is null
  ) then
    raise exception
      'R3 identity foundation validation failed: missing exact Supabase identity mapping';
  end if;

  if exists (
    select 1
    from private.identity_links identity_link
    left join auth.users auth_user
      on identity_link.provider = 'supabase'
     and identity_link.provider_subject = auth_user.id::text
    where identity_link.provider = 'supabase'
      and (
        auth_user.id is null
        or identity_link.profile_id <> auth_user.id
      )
  ) then
    raise exception
      'R3 identity foundation validation failed: invalid Supabase identity mapping';
  end if;
end;
$$;

-- Preserve the existing auth-user → profile synchronization behavior exactly,
-- then add identity-link synchronization after the profile exists.
--
-- Do not change the existing profile field semantics.

create or replace function private.sync_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 160),
    lower(coalesce(new.email, ''))
  )
  on conflict (id) do update
  set
    full_name = case
      when coalesce(excluded.full_name, '') = '' then public.profiles.full_name
      else excluded.full_name
    end,
    email = excluded.email,
    updated_at = now();

  insert into private.identity_links (
    provider,
    provider_subject,
    profile_id
  )
  values (
    'supabase',
    new.id::text,
    new.id
  )
  on conflict (provider, provider_subject) do nothing;

  if not exists (
    select 1
    from private.identity_links identity_link
    where identity_link.provider = 'supabase'
      and identity_link.provider_subject = new.id::text
      and identity_link.profile_id = new.id
  ) then
    raise exception
      'R3 identity synchronization failed: Supabase identity does not map to the expected TINDIO profile';
  end if;

  return new;
end;
$$;

revoke execute
on function private.sync_auth_user_profile()
from public, anon, authenticated, service_role;
