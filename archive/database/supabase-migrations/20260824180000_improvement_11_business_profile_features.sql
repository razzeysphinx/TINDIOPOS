-- Improvement 11: organization business profiles and non-destructive feature controls.
begin;

alter table public.organizations
  add column business_type text not null default 'retail',
  add constraint organizations_business_type_values check (
    business_type in (
      'retail',
      'grocery',
      'convenience_store',
      'restaurant_cafe',
      'bar',
      'wholesale',
      'service',
      'other'
    )
  );

create table public.organization_features (
  organization_id uuid not null references public.organizations (id) on delete restrict,
  feature_key text not null,
  is_enabled boolean not null default false,
  updated_by_employee_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, feature_key),
  constraint organization_features_key_values check (
    feature_key in (
      'inventory',
      'shifts',
      'time_clock',
      'open_tickets',
      'dining',
      'modifiers',
      'loyalty',
      'customer_display',
      'kitchen_display',
      'purchase_orders',
      'transfers',
      'production',
      'weighted_products',
      'multi_store'
    )
  ),
  constraint organization_features_updated_by_employee_fkey
    foreign key (updated_by_employee_id, organization_id)
    references public.employees (id, organization_id)
    on delete restrict
);

create trigger organization_features_set_updated_at
before update on public.organization_features
for each row execute function private.set_updated_at();

create or replace function private.business_feature_recommendations(target_business_type text)
returns table (feature_key text, is_enabled boolean)
language sql
immutable
security invoker
set search_path = ''
as $$
  with normalized as (
    select case
      when target_business_type in (
        'retail', 'grocery', 'convenience_store', 'restaurant_cafe',
        'bar', 'wholesale', 'service', 'other'
      ) then target_business_type
      else 'retail'
    end as business_type
  )
  select feature.feature_key,
    case feature.feature_key
      when 'inventory' then normalized.business_type <> 'service'
      when 'shifts' then true
      when 'time_clock' then true
      when 'open_tickets' then normalized.business_type in ('restaurant_cafe', 'bar')
      when 'dining' then normalized.business_type in ('restaurant_cafe', 'bar')
      when 'modifiers' then normalized.business_type in ('restaurant_cafe', 'bar')
      when 'loyalty' then normalized.business_type <> 'wholesale'
      when 'customer_display' then normalized.business_type in ('restaurant_cafe', 'bar')
      when 'kitchen_display' then normalized.business_type in ('restaurant_cafe', 'bar')
      when 'purchase_orders' then normalized.business_type in ('retail', 'grocery', 'convenience_store', 'restaurant_cafe', 'bar', 'wholesale')
      when 'transfers' then normalized.business_type in ('retail', 'grocery', 'convenience_store', 'restaurant_cafe', 'bar', 'wholesale')
      when 'production' then normalized.business_type in ('restaurant_cafe', 'bar')
      when 'weighted_products' then normalized.business_type in ('grocery', 'convenience_store', 'restaurant_cafe', 'bar', 'wholesale')
      when 'multi_store' then normalized.business_type = 'wholesale'
      else false
    end
  from normalized
  cross join (
    values
      ('inventory'), ('shifts'), ('time_clock'), ('open_tickets'),
      ('dining'), ('modifiers'), ('loyalty'), ('customer_display'),
      ('kitchen_display'), ('purchase_orders'), ('transfers'), ('production'),
      ('weighted_products'), ('multi_store')
  ) as feature(feature_key);
$$;

create or replace function private.seed_organization_feature_recommendations(
  target_organization_id uuid,
  target_business_type text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.organization_features (organization_id, feature_key, is_enabled)
  select target_organization_id, recommendation.feature_key, recommendation.is_enabled
  from private.business_feature_recommendations(target_business_type) recommendation
  on conflict (organization_id, feature_key) do update
  set is_enabled = excluded.is_enabled,
      updated_by_employee_id = null;
end;
$$;

create or replace function private.seed_organization_features_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_organization_feature_recommendations(new.id, new.business_type);
  return new;
end;
$$;

create trigger organizations_seed_feature_recommendations
after insert on public.organizations
for each row execute function private.seed_organization_features_after_insert();

-- Existing organizations are intentionally enabled for every feature. This
-- preserves the workflows they already use; owners can later tailor them.
insert into public.organization_features (organization_id, feature_key, is_enabled)
select organization.id, feature.feature_key, true
from public.organizations organization
cross join (
  values
    ('inventory'), ('shifts'), ('time_clock'), ('open_tickets'),
    ('dining'), ('modifiers'), ('loyalty'), ('customer_display'),
    ('kitchen_display'), ('purchase_orders'), ('transfers'), ('production'),
    ('weighted_products'), ('multi_store')
) as feature(feature_key)
on conflict (organization_id, feature_key) do nothing;

alter table public.organization_features enable row level security;

create policy organization_features_select_member
on public.organization_features for select
to authenticated
using ((select private.is_organization_member(organization_id)));

revoke all on public.organization_features from public, anon, authenticated, service_role;
grant select on public.organization_features to authenticated;

create or replace function private.update_business_profile_features(
  target_organization_id uuid,
  target_business_type text,
  target_feature_settings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_business_type text := lower(btrim(coalesce(target_business_type, '')));
  actor_employee_id uuid;
  previous_business_type text;
  previous_feature_settings jsonb;
  current_feature_settings jsonb;
begin
  if (select auth.uid()) is null
     or not (select private.has_permission(target_organization_id, 'settings.manage')) then
    raise exception 'Business profile permission is required.' using errcode = '42501';
  end if;

  if normalized_business_type not in (
    'retail', 'grocery', 'convenience_store', 'restaurant_cafe',
    'bar', 'wholesale', 'service', 'other'
  ) then
    raise exception 'Choose a supported business type.' using errcode = '22023';
  end if;

  if target_feature_settings is null or jsonb_typeof(target_feature_settings) <> 'object' then
    raise exception 'Feature settings must be an object.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_each(target_feature_settings) as setting(feature_key, feature_value)
    where setting.feature_key not in (
      'inventory', 'shifts', 'time_clock', 'open_tickets', 'dining',
      'modifiers', 'loyalty', 'customer_display', 'kitchen_display',
      'purchase_orders', 'transfers', 'production', 'weighted_products',
      'multi_store'
    )
      or jsonb_typeof(setting.feature_value) <> 'boolean'
  ) then
    raise exception 'Feature settings contain an unsupported value.' using errcode = '22023';
  end if;

  select organization.business_type
  into previous_business_type
  from public.organizations organization
  where organization.id = target_organization_id
  for update;

  if previous_business_type is null then
    raise exception 'The organization could not be found.' using errcode = '23514';
  end if;

  select coalesce(jsonb_object_agg(feature.feature_key, feature.is_enabled), '{}'::jsonb)
  into previous_feature_settings
  from public.organization_features feature
  where feature.organization_id = target_organization_id;

  select private.current_employee_id(target_organization_id)
  into actor_employee_id;

  if actor_employee_id is null then
    raise exception 'An active employee is required.' using errcode = '42501';
  end if;

  update public.organizations
  set business_type = normalized_business_type
  where id = target_organization_id;

  insert into public.organization_features (
    organization_id,
    feature_key,
    is_enabled,
    updated_by_employee_id
  )
  select
    target_organization_id,
    recommendation.feature_key,
    case
      when target_feature_settings ? recommendation.feature_key
        then (target_feature_settings ->> recommendation.feature_key)::boolean
      else coalesce(current_feature.is_enabled, recommendation.is_enabled)
    end,
    actor_employee_id
  from private.business_feature_recommendations(normalized_business_type) recommendation
  left join public.organization_features current_feature
    on current_feature.organization_id = target_organization_id
   and current_feature.feature_key = recommendation.feature_key
  on conflict (organization_id, feature_key) do update
  set is_enabled = excluded.is_enabled,
      updated_by_employee_id = excluded.updated_by_employee_id;

  select coalesce(jsonb_object_agg(feature.feature_key, feature.is_enabled), '{}'::jsonb)
  into current_feature_settings
  from public.organization_features feature
  where feature.organization_id = target_organization_id;

  perform private.write_audit_log(
    target_organization_id,
    'BUSINESS_PROFILE_UPDATED',
    'settings.manage',
    actor_employee_id,
    null,
    null,
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'previous_business_type', previous_business_type,
      'business_type', normalized_business_type,
      'previous_feature_settings', previous_feature_settings,
      'feature_settings', current_feature_settings
    )
  );

  return current_feature_settings;
end;
$$;

create or replace function public.update_business_profile_features(
  target_organization_id uuid,
  target_business_type text,
  target_feature_settings jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.update_business_profile_features(
    target_organization_id,
    target_business_type,
    target_feature_settings
  );
$$;

create or replace function public.bootstrap_organization_v2(
  organization_name text,
  store_name text,
  register_name text,
  currency_code text default 'PHP',
  timezone_name text default 'Asia/Manila',
  business_type text default 'retail'
)
returns table (
  organization_id uuid,
  store_id uuid,
  register_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_business_type text := lower(btrim(coalesce(business_type, '')));
  new_organization_id uuid;
  new_store_id uuid;
  new_register_id uuid;
  recommended_features jsonb;
begin
  if normalized_business_type not in (
    'retail', 'grocery', 'convenience_store', 'restaurant_cafe',
    'bar', 'wholesale', 'service', 'other'
  ) then
    raise exception 'Choose a supported business type.' using errcode = '22023';
  end if;

  select created.organization_id, created.store_id, created.register_id
  into new_organization_id, new_store_id, new_register_id
  from public.bootstrap_organization(
    organization_name,
    store_name,
    register_name,
    currency_code,
    timezone_name
  ) created;

  select coalesce(jsonb_object_agg(recommendation.feature_key, recommendation.is_enabled), '{}'::jsonb)
  into recommended_features
  from private.business_feature_recommendations(normalized_business_type) recommendation;

  perform public.update_business_profile_features(
    new_organization_id,
    normalized_business_type,
    recommended_features
  );

  return query
  select new_organization_id, new_store_id, new_register_id;
end;
$$;

revoke execute on function private.business_feature_recommendations(text) from public, anon, authenticated, service_role;
revoke execute on function private.seed_organization_feature_recommendations(uuid, text) from public, anon, authenticated, service_role;
revoke execute on function private.seed_organization_features_after_insert() from public, anon, authenticated, service_role;
revoke execute on function private.update_business_profile_features(uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.update_business_profile_features(uuid, text, jsonb) from public, anon, service_role;
revoke execute on function public.bootstrap_organization_v2(text, text, text, text, text, text) from public, anon, service_role;
grant execute on function public.update_business_profile_features(uuid, text, jsonb) to authenticated;
grant execute on function public.bootstrap_organization_v2(text, text, text, text, text, text) to authenticated;

comment on table public.organization_features is 'Organization-scoped, non-destructive feature availability controls. Historical feature data is never removed when a flag is disabled.';
comment on function public.update_business_profile_features(uuid, text, jsonb) is 'Owner/admin business profile and feature update with permission validation and an audit record.';
comment on function public.bootstrap_organization_v2(text, text, text, text, text, text) is 'Creates a new organization with business-type feature recommendations while retaining the original bootstrap routine for existing clients.';

commit;
