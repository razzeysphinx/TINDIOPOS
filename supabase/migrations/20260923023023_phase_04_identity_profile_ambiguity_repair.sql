-- Phase 04: remove the PL/pgSQL variable/column ambiguity in the
-- externally authenticated identity provisioning boundary.

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
  current_provider_subject text;
  resolved_profile_id uuid;
begin
  current_provider_subject :=
    private.current_identity_subject();

  if current_provider_subject is null
    or btrim(current_provider_subject) = ''
  then
    raise exception
      'An authenticated identity is required.'
      using errcode = '42501';
  end if;

  begin
    resolved_profile_id :=
      current_provider_subject::uuid;
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
    left(coalesce(target_full_name, ''), 160),
    lower(coalesce(target_email, ''))
  )
  on conflict (id)
  do update
  set
    full_name =
      case
        when btrim(coalesce(excluded.full_name, '')) = ''
        then public.profiles.full_name
        else excluded.full_name
      end,
    email =
      case
        when btrim(coalesce(excluded.email, '')) = ''
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
    current_provider_subject,
    resolved_profile_id
  )
  on conflict on constraint identity_links_pkey
  do update
  set
    profile_id = excluded.profile_id,
    updated_at = now();

  if not exists (
    select 1
    from private.identity_links identity_link
    where identity_link.provider = 'supabase'
      and identity_link.provider_subject = current_provider_subject
      and identity_link.profile_id = resolved_profile_id
  ) then
    raise exception
      'TINDIO identity provisioning failed.'
      using errcode = '42501';
  end if;

  return resolved_profile_id;
end;
$$;

comment on function
  public.ensure_current_identity_profile(text, text)
is
'Ensures the current externally authenticated Supabase subject has a permanent TINDIO profile and identity link. Used during the Neon database migration while Supabase Auth remains authoritative.';

revoke all
on function public.ensure_current_identity_profile(text, text)
from public, anon, service_role;

grant execute
on function public.ensure_current_identity_profile(text, text)
to authenticated;
