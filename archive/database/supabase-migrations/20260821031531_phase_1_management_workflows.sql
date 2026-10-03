-- TINDIO Phase 1 continuation: management mutations and employee invitations.
-- This migration is additive. Existing business data is not removed or rewritten.

create table public.employee_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  email text not null,
  employee_number text not null,
  job_title text,
  role_id uuid not null,
  store_id uuid not null,
  organization_name_snapshot text not null,
  role_name_snapshot text not null,
  store_name_snapshot text not null,
  token_hash text not null,
  invited_by uuid not null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_by uuid references auth.users (id) on delete restrict,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint employee_invitations_role_organization_fkey
    foreign key (role_id, organization_id)
    references public.roles (id, organization_id)
    on delete restrict,
  constraint employee_invitations_store_organization_fkey
    foreign key (store_id, organization_id)
    references public.stores (id, organization_id)
    on delete restrict,
  constraint employee_invitations_inviter_organization_fkey
    foreign key (invited_by, organization_id)
    references public.employees (id, organization_id)
    on delete restrict,
  constraint employee_invitations_email_normalized
    check (
      email = lower(btrim(email))
      and char_length(email) between 3 and 320
      and position('@' in email) > 1
    ),
  constraint employee_invitations_number_format
    check (employee_number ~ '^[A-Z0-9][A-Z0-9_-]{1,31}$'),
  constraint employee_invitations_job_title_length
    check (job_title is null or char_length(job_title) <= 120),
  constraint employee_invitations_snapshot_lengths
    check (
      char_length(organization_name_snapshot) between 2 and 160
      and char_length(role_name_snapshot) between 2 and 80
      and char_length(store_name_snapshot) between 2 and 160
    ),
  constraint employee_invitations_token_hash_format
    check (token_hash ~ '^[a-f0-9]{64}$'),
  constraint employee_invitations_expiry_window
    check (
      expires_at > created_at
      and expires_at <= created_at + interval '30 days'
    ),
  constraint employee_invitations_acceptance_pair
    check ((accepted_at is null) = (accepted_by is null)),
  constraint employee_invitations_terminal_state
    check (accepted_at is null or revoked_at is null),
  constraint employee_invitations_token_hash_unique unique (token_hash)
);

create index employee_invitations_organization_id_idx
  on public.employee_invitations (organization_id);
create index employee_invitations_role_id_idx
  on public.employee_invitations (role_id);
create index employee_invitations_store_id_idx
  on public.employee_invitations (store_id);
create index employee_invitations_invited_by_idx
  on public.employee_invitations (invited_by);
create index employee_invitations_accepted_by_idx
  on public.employee_invitations (accepted_by)
  where accepted_by is not null;
create unique index employee_invitations_active_email_unique_idx
  on public.employee_invitations (organization_id, lower(email))
  where accepted_at is null and revoked_at is null;
create unique index employee_invitations_active_number_unique_idx
  on public.employee_invitations (organization_id, employee_number)
  where accepted_at is null and revoked_at is null;
create index employee_invitations_pending_recipient_idx
  on public.employee_invitations (lower(email), expires_at)
  where accepted_at is null and revoked_at is null;

create or replace function private.set_employee_invitation_snapshots()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select organization.name, role.name, store.name
  into
    new.organization_name_snapshot,
    new.role_name_snapshot,
    new.store_name_snapshot
  from public.organizations organization
  join public.roles role
    on role.organization_id = organization.id
   and role.id = new.role_id
  join public.stores store
    on store.organization_id = organization.id
   and store.id = new.store_id
  where organization.id = new.organization_id;

  if not found then
    raise exception 'Invitation role or store does not belong to the organization.' using errcode = '23503';
  end if;

  return new;
end;
$$;

revoke execute on function private.set_employee_invitation_snapshots()
from public, anon, authenticated, service_role;

create trigger employee_invitations_set_snapshots
before insert on public.employee_invitations
for each row execute function private.set_employee_invitation_snapshots();

create or replace function private.can_grant_role(
  target_organization_id uuid,
  target_role_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and (select private.has_permission(
      target_organization_id,
      'employees.manage'
    ))
    and exists (
      select 1
      from public.roles role
      where role.id = target_role_id
        and role.organization_id = target_organization_id
    )
    and not exists (
      select 1
      from public.role_permissions role_permission
      where role_permission.organization_id = target_organization_id
        and role_permission.role_id = target_role_id
        and not (select private.has_permission(
          target_organization_id,
          role_permission.permission_code
        ))
    );
$$;

revoke execute on function private.can_grant_role(uuid, uuid)
from public, anon, authenticated, service_role;

-- RLS policies can use private security-definer predicates without exposing
-- those predicates as callable Data API functions.
revoke execute on function private.is_organization_creator(uuid) from authenticated;
revoke execute on function private.is_organization_member(uuid) from authenticated;
revoke execute on function private.has_permission(uuid, text) from authenticated;
revoke execute on function private.can_view_employee_profile(uuid) from authenticated;

drop policy roles_update_authorized on public.roles;
create policy roles_update_authorized
on public.roles for update
to authenticated
using (
  not is_system
  and (select private.has_permission(organization_id, 'roles.manage'))
)
with check (
  not is_system
  and (select private.has_permission(organization_id, 'roles.manage'))
);

drop policy role_permissions_insert_authorized on public.role_permissions;
create policy role_permissions_insert_authorized
on public.role_permissions for insert
to authenticated
with check (
  (select private.is_organization_creator(organization_id))
  or (
    (select private.has_permission(organization_id, 'roles.manage'))
    and (select private.has_permission(organization_id, permission_code))
    and exists (
      select 1
      from public.roles role
      where role.id = role_permissions.role_id
        and role.organization_id = role_permissions.organization_id
        and not role.is_system
    )
  )
);

drop policy role_permissions_delete_authorized on public.role_permissions;
create policy role_permissions_delete_authorized
on public.role_permissions for delete
to authenticated
using (
  (select private.has_permission(organization_id, 'roles.manage'))
  and (select private.can_grant_role(organization_id, role_id))
  and exists (
    select 1
    from public.roles role
    where role.id = role_permissions.role_id
      and role.organization_id = role_permissions.organization_id
      and not role.is_system
  )
);

drop policy employee_roles_insert_authorized on public.employee_roles;
create policy employee_roles_insert_authorized
on public.employee_roles for insert
to authenticated
with check (
  (select private.is_organization_creator(organization_id))
  or (
    (select private.has_permission(organization_id, 'employees.manage'))
    and (select private.can_grant_role(organization_id, role_id))
  )
);

alter table public.employee_invitations enable row level security;

create policy employee_invitations_select_authorized
on public.employee_invitations for select
to authenticated
using (
  (select private.has_permission(organization_id, 'employees.manage'))
  or (
    accepted_at is null
    and revoked_at is null
    and expires_at > now()
    and lower(email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  )
);

create policy employee_invitations_insert_authorized
on public.employee_invitations for insert
to authenticated
with check (
  (select private.has_permission(organization_id, 'employees.manage'))
  and (select private.can_grant_role(organization_id, role_id))
  and exists (
    select 1
    from public.employees inviter
    where inviter.id = employee_invitations.invited_by
      and inviter.organization_id = employee_invitations.organization_id
      and inviter.profile_id = (select auth.uid())
      and inviter.status = 'active'
  )
);

create policy employee_invitations_revoke_authorized
on public.employee_invitations for update
to authenticated
using (
  accepted_at is null
  and (select private.has_permission(organization_id, 'employees.manage'))
)
with check (
  accepted_at is null
  and revoked_at is not null
  and (select private.has_permission(organization_id, 'employees.manage'))
);

revoke all on public.employee_invitations from anon, authenticated;
grant select, insert on public.employee_invitations to authenticated;
grant update (revoked_at) on public.employee_invitations to authenticated;

create or replace function public.create_custom_role(
  target_organization_id uuid,
  role_name text,
  role_code text,
  role_description text,
  permission_codes text[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_name text := btrim(role_name);
  normalized_code text := lower(btrim(role_code));
  normalized_description text := nullif(btrim(role_description), '');
  new_role_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if char_length(normalized_name) not between 2 and 80 then
    raise exception 'Role name must contain between 2 and 80 characters.' using errcode = '22023';
  end if;

  if normalized_code !~ '^[a-z][a-z0-9_]{1,39}$' then
    raise exception 'Role code has an invalid format.' using errcode = '22023';
  end if;

  if coalesce(cardinality(permission_codes), 0) = 0 then
    raise exception 'Select at least one permission.' using errcode = '22023';
  end if;

  insert into public.roles (
    organization_id,
    name,
    code,
    description,
    is_system
  )
  values (
    target_organization_id,
    normalized_name,
    normalized_code,
    normalized_description,
    false
  )
  returning id into new_role_id;

  insert into public.role_permissions (
    organization_id,
    role_id,
    permission_code
  )
  select
    target_organization_id,
    new_role_id,
    requested_permission.permission_code
  from (
    select distinct unnest(permission_codes) as permission_code
  ) requested_permission;

  return new_role_id;
end;
$$;

revoke execute on function public.create_custom_role(uuid, text, text, text, text[])
from public, anon;
grant execute on function public.create_custom_role(uuid, text, text, text, text[])
to authenticated;

create or replace function private.accept_employee_invitation(
  invitation_token_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_user_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
  invitation public.employee_invitations%rowtype;
  new_employee_id uuid;
begin
  if current_user_id is null or current_user_email = '' then
    raise exception 'Authentication with a verified email is required.' using errcode = '42501';
  end if;

  if invitation_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invitation token is invalid.' using errcode = '22023';
  end if;

  select *
  into invitation
  from public.employee_invitations employee_invitation
  where employee_invitation.token_hash = invitation_token_hash
    and employee_invitation.email = current_user_email
    and employee_invitation.accepted_at is null
    and employee_invitation.revoked_at is null
    and employee_invitation.expires_at > now()
  for update;

  if not found then
    raise exception 'Invitation is invalid, expired, or belongs to another email.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.employees employee
    where employee.profile_id = current_user_id
  ) then
    raise exception 'This account already belongs to an organization.' using errcode = '23505';
  end if;

  insert into public.employees (
    organization_id,
    profile_id,
    employee_number,
    job_title,
    status
  )
  values (
    invitation.organization_id,
    current_user_id,
    invitation.employee_number,
    invitation.job_title,
    'active'
  )
  returning id into new_employee_id;

  insert into public.employee_roles (organization_id, employee_id, role_id)
  values (invitation.organization_id, new_employee_id, invitation.role_id);

  insert into public.employee_stores (organization_id, employee_id, store_id)
  values (invitation.organization_id, new_employee_id, invitation.store_id);

  update public.employee_invitations
  set
    accepted_by = current_user_id,
    accepted_at = now()
  where id = invitation.id;

  return new_employee_id;
end;
$$;

revoke execute on function private.accept_employee_invitation(text)
from public, anon, authenticated, service_role;
grant execute on function private.accept_employee_invitation(text) to authenticated;

create or replace function public.accept_employee_invitation(
  invitation_token_hash text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.accept_employee_invitation(invitation_token_hash);
$$;

revoke execute on function public.accept_employee_invitation(text)
from public, anon;
grant execute on function public.accept_employee_invitation(text) to authenticated;

comment on table public.employee_invitations
is 'Time-limited employee onboarding invitations. Only SHA-256 token hashes are stored.';

comment on function public.create_custom_role(uuid, text, text, text, text[])
is 'Atomically creates a custom role and only permissions the caller is authorized to grant.';

comment on function public.accept_employee_invitation(text)
is 'Accepts a pending invitation for the authenticated matching email and atomically creates employee assignments.';
