begin;

-- Provider-neutral profile identity must not depend on the physical
-- presence of Supabase Auth tables in the business database.

alter table public.profiles
  drop constraint if exists profiles_id_fkey;

alter table public.organizations
  drop constraint if exists organizations_created_by_fkey;

alter table public.organizations
  drop constraint if exists organizations_created_by_profile_fkey;

alter table public.organizations
  add constraint organizations_created_by_profile_fkey
  foreign key (created_by)
  references public.profiles (id)
  on delete restrict;

-- Invitation acceptance stores the permanent TINDIO profile UUID.
--
-- During the Supabase-only period the profile UUID intentionally matched the
-- external auth.users UUID, so this relationship historically pointed to
-- auth.users. The value is business identity and belongs to public.profiles.

alter table public.employee_invitations
  drop constraint if exists employee_invitations_accepted_by_fkey;

alter table public.employee_invitations
  drop constraint if exists employee_invitations_accepted_by_profile_fkey;

alter table public.employee_invitations
  add constraint employee_invitations_accepted_by_profile_fkey
  foreign key (accepted_by)
  references public.profiles (id)
  on delete restrict;

-- Fail if another public/private TINDIO foreign key still points directly
-- at auth.users. Do not silently carry hidden Supabase database coupling
-- into the Neon baseline.
do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    join pg_catalog.pg_class source_table
      on source_table.oid =
        constraint_record.conrelid
    join pg_catalog.pg_namespace source_namespace
      on source_namespace.oid =
        source_table.relnamespace
    join pg_catalog.pg_class target_table
      on target_table.oid =
        constraint_record.confrelid
    join pg_catalog.pg_namespace target_namespace
      on target_namespace.oid =
        target_table.relnamespace
    where constraint_record.contype = 'f'
      and source_namespace.nspname in ('public', 'private')
      and target_namespace.nspname = 'auth'
      and target_table.relname = 'users'
  ) then
    raise exception
      'Phase 04 portability blocked: a TINDIO foreign key still references auth.users';
  end if;
end;
$$;

-- Supabase Auth remains the external authentication authority during
-- Phase 04. New or newly confirmed users must be provisioned into the
-- TINDIO-owned profile/identity bridge explicitly because Neon does not
-- run the Supabase auth.users trigger.

create or replace function public.ensure_current_identity_profile(
  target_email text,
  target_full_name text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider_subject text;
  resolved_profile_id uuid;
begin
  provider_subject :=
    private.current_identity_subject();

  if provider_subject is null
    or btrim(provider_subject) = ''
  then
    raise exception
      'An authenticated identity is required.'
      using errcode = '42501';
  end if;

  begin
    resolved_profile_id :=
      provider_subject::uuid;
  exception
    when invalid_text_representation then
      raise exception
        'The current Supabase identity is not a UUID.'
        using errcode = '42501';
  end;

  insert into public.profiles (
    id,
    full_name,
    email
  )
  values (
    resolved_profile_id,
    left(
      coalesce(
        target_full_name,
        ''
      ),
      160
    ),
    lower(
      coalesce(
        target_email,
        ''
      )
    )
  )
  on conflict (id)
  do update
  set
    full_name =
      case
        when btrim(
          coalesce(
            excluded.full_name,
            ''
          )
        ) = ''
        then public.profiles.full_name
        else excluded.full_name
      end,

    email =
      case
        when btrim(
          coalesce(
            excluded.email,
            ''
          )
        ) = ''
        then public.profiles.email
        else excluded.email
      end,

    updated_at = now();

  insert into private.identity_links (
    provider,
    provider_subject,
    profile_id
  )
  values (
    'supabase',
    provider_subject,
    resolved_profile_id
  )
  on conflict (
    provider,
    provider_subject
  )
  do update
  set
    profile_id =
      excluded.profile_id,
    updated_at =
      now();

  if not exists (
    select 1
    from private.identity_links identity_link
    where identity_link.provider =
      'supabase'
      and identity_link.provider_subject =
        provider_subject
      and identity_link.profile_id =
        resolved_profile_id
  ) then
    raise exception
      'TINDIO identity provisioning failed.'
      using errcode = '42501';
  end if;

  return resolved_profile_id;
end;
$$;

comment on function
  public.ensure_current_identity_profile(
    text,
    text
  )
is
'Ensures the current externally authenticated Supabase subject has a permanent TINDIO profile and identity link. Used during the Neon database migration while Supabase Auth remains authoritative.';

revoke all
on function
  public.ensure_current_identity_profile(
    text,
    text
  )
from public;

revoke all
on function
  public.ensure_current_identity_profile(
    text,
    text
  )
from anon;

revoke all
on function
  public.ensure_current_identity_profile(
    text,
    text
  )
from service_role;

grant execute
on function
  public.ensure_current_identity_profile(
    text,
    text
  )
to authenticated;

commit;
