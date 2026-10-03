-- TINDIO Planning Document Phase 7: Smart Menu V1.
--
-- A Smart Menu never owns a second product catalogue. It is only a
-- store-scoped selection and display configuration. The public function at
-- the end is the sole anonymous read boundary; it returns a deliberately
-- small, enabled-only projection of the live catalogue.

begin;

create table public.smart_menus (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  store_id uuid not null,
  is_enabled boolean not null default false,
  show_prices boolean not null default true,
  show_images boolean not null default true,
  show_unavailable boolean not null default false,
  show_variants boolean not null default true,
  show_modifiers boolean not null default true,
  created_by_employee_id uuid,
  updated_by_employee_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint smart_menus_organization_store_unique unique (organization_id, store_id),
  constraint smart_menus_id_organization_unique unique (id, organization_id),
  constraint smart_menus_store_organization_fkey
    foreign key (store_id, organization_id)
    references public.stores (id, organization_id)
    on delete cascade,
  constraint smart_menus_created_by_organization_fkey
    foreign key (created_by_employee_id, organization_id)
    references public.employees (id, organization_id)
    on delete restrict,
  constraint smart_menus_updated_by_organization_fkey
    foreign key (updated_by_employee_id, organization_id)
    references public.employees (id, organization_id)
    on delete restrict
);

create index smart_menus_enabled_lookup_idx
  on public.smart_menus (id)
  where is_enabled;

create trigger smart_menus_set_updated_at
before update on public.smart_menus
for each row execute function private.set_updated_at();

create table public.smart_menu_categories (
  smart_menu_id uuid not null,
  organization_id uuid not null,
  category_id uuid not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (smart_menu_id, category_id),
  constraint smart_menu_categories_menu_organization_fkey
    foreign key (smart_menu_id, organization_id)
    references public.smart_menus (id, organization_id)
    on delete cascade,
  constraint smart_menu_categories_category_organization_fkey
    foreign key (category_id, organization_id)
    references public.categories (id, organization_id)
    on delete restrict,
  constraint smart_menu_categories_sort_order_nonnegative check (sort_order >= 0)
);

create index smart_menu_categories_menu_order_idx
  on public.smart_menu_categories (smart_menu_id, sort_order, category_id);

create table public.smart_menu_products (
  smart_menu_id uuid not null,
  organization_id uuid not null,
  product_id uuid not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (smart_menu_id, product_id),
  constraint smart_menu_products_menu_organization_fkey
    foreign key (smart_menu_id, organization_id)
    references public.smart_menus (id, organization_id)
    on delete cascade,
  constraint smart_menu_products_product_organization_fkey
    foreign key (product_id, organization_id)
    references public.products (id, organization_id)
    on delete restrict,
  constraint smart_menu_products_sort_order_nonnegative check (sort_order >= 0)
);

create index smart_menu_products_menu_order_idx
  on public.smart_menu_products (smart_menu_id, sort_order, product_id);

alter table public.smart_menus enable row level security;
alter table public.smart_menu_categories enable row level security;
alter table public.smart_menu_products enable row level security;

revoke all on table public.smart_menus, public.smart_menu_categories, public.smart_menu_products
from public, anon, authenticated, service_role;

create policy smart_menus_select_member
on public.smart_menus for select
to authenticated
using ((select private.is_organization_member(organization_id)));

create policy smart_menus_insert_settings_manager
on public.smart_menus for insert
to authenticated
with check ((select private.has_permission(organization_id, 'settings.manage')));

create policy smart_menus_update_settings_manager
on public.smart_menus for update
to authenticated
using ((select private.has_permission(organization_id, 'settings.manage')))
with check ((select private.has_permission(organization_id, 'settings.manage')));

create policy smart_menus_delete_settings_manager
on public.smart_menus for delete
to authenticated
using ((select private.has_permission(organization_id, 'settings.manage')));

create policy smart_menu_categories_select_member
on public.smart_menu_categories for select
to authenticated
using ((select private.is_organization_member(organization_id)));

create policy smart_menu_categories_insert_settings_manager
on public.smart_menu_categories for insert
to authenticated
with check ((select private.has_permission(organization_id, 'settings.manage')));

create policy smart_menu_categories_update_settings_manager
on public.smart_menu_categories for update
to authenticated
using ((select private.has_permission(organization_id, 'settings.manage')))
with check ((select private.has_permission(organization_id, 'settings.manage')));

create policy smart_menu_categories_delete_settings_manager
on public.smart_menu_categories for delete
to authenticated
using ((select private.has_permission(organization_id, 'settings.manage')));

create policy smart_menu_products_select_member
on public.smart_menu_products for select
to authenticated
using ((select private.is_organization_member(organization_id)));

create policy smart_menu_products_insert_settings_manager
on public.smart_menu_products for insert
to authenticated
with check ((select private.has_permission(organization_id, 'settings.manage')));

create policy smart_menu_products_update_settings_manager
on public.smart_menu_products for update
to authenticated
using ((select private.has_permission(organization_id, 'settings.manage')))
with check ((select private.has_permission(organization_id, 'settings.manage')));

create policy smart_menu_products_delete_settings_manager
on public.smart_menu_products for delete
to authenticated
using ((select private.has_permission(organization_id, 'settings.manage')));

grant select, insert, update, delete on table public.smart_menus, public.smart_menu_categories, public.smart_menu_products
to authenticated;

create function public.save_smart_menu_configuration(
  target_store_id uuid,
  target_is_enabled boolean,
  target_show_prices boolean,
  target_show_images boolean,
  target_show_unavailable boolean,
  target_show_variants boolean,
  target_show_modifiers boolean,
  target_category_ids uuid[],
  target_product_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  target_menu_id uuid;
  actor_employee_id uuid;
  selected_category_ids uuid[] := coalesce(target_category_ids, '{}'::uuid[]);
  selected_product_ids uuid[] := coalesce(target_product_ids, '{}'::uuid[]);
begin
  select store.organization_id
  into target_organization_id
  from public.stores store
  where store.id = target_store_id
    and store.is_active
  for key share;

  if target_organization_id is null then
    raise exception 'Choose an active store for this Smart Menu.' using errcode = 'P0002';
  end if;

  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'settings.manage')) then
    raise exception 'Settings permission is required to configure Smart Menu.' using errcode = '42501';
  end if;

  if target_is_enabled is null
    or target_show_prices is null
    or target_show_images is null
    or target_show_unavailable is null
    or target_show_variants is null
    or target_show_modifiers is null then
    raise exception 'Smart Menu display settings are required.' using errcode = '23514';
  end if;

  if exists (select 1 from unnest(selected_category_ids) selected(category_id) where selected.category_id is null)
    or cardinality(selected_category_ids) <> (select count(distinct selected.category_id) from unnest(selected_category_ids) selected(category_id)) then
    raise exception 'Choose each Smart Menu category only once.' using errcode = '23514';
  end if;

  if exists (select 1 from unnest(selected_product_ids) selected(product_id) where selected.product_id is null)
    or cardinality(selected_product_ids) <> (select count(distinct selected.product_id) from unnest(selected_product_ids) selected(product_id)) then
    raise exception 'Choose each Smart Menu product only once.' using errcode = '23514';
  end if;

  if target_is_enabled and (cardinality(selected_category_ids) = 0 or cardinality(selected_product_ids) = 0) then
    raise exception 'Choose at least one category and product before enabling Smart Menu.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from unnest(selected_category_ids) selected(category_id)
    left join public.categories category
      on category.id = selected.category_id
     and category.organization_id = target_organization_id
    where category.id is null
       or category.is_archived
  ) then
    raise exception 'Smart Menu categories must be active categories in this business.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from unnest(selected_product_ids) selected(product_id)
    left join public.products product
      on product.id = selected.product_id
     and product.organization_id = target_organization_id
    where product.id is null
       or product.status <> 'active'
       or product.is_composite
       or product.category_id is null
       or not (product.category_id = any(selected_category_ids))
  ) then
    raise exception 'Smart Menu products must be active, non-composite products in a selected category.' using errcode = '23514';
  end if;

  select private.current_employee_id(target_organization_id)
  into actor_employee_id;
  if actor_employee_id is null then
    raise exception 'An active employee is required to configure Smart Menu.' using errcode = '42501';
  end if;

  insert into public.smart_menus (
    organization_id,
    store_id,
    is_enabled,
    show_prices,
    show_images,
    show_unavailable,
    show_variants,
    show_modifiers,
    created_by_employee_id,
    updated_by_employee_id
  )
  values (
    target_organization_id,
    target_store_id,
    target_is_enabled,
    target_show_prices,
    target_show_images,
    target_show_unavailable,
    target_show_variants,
    target_show_modifiers,
    actor_employee_id,
    actor_employee_id
  )
  on conflict (organization_id, store_id) do update
  set
    is_enabled = excluded.is_enabled,
    show_prices = excluded.show_prices,
    show_images = excluded.show_images,
    show_unavailable = excluded.show_unavailable,
    show_variants = excluded.show_variants,
    show_modifiers = excluded.show_modifiers,
    updated_by_employee_id = excluded.updated_by_employee_id,
    updated_at = now()
  returning id into target_menu_id;

  delete from public.smart_menu_categories where smart_menu_id = target_menu_id;
  delete from public.smart_menu_products where smart_menu_id = target_menu_id;

  insert into public.smart_menu_categories (smart_menu_id, organization_id, category_id, sort_order)
  select target_menu_id, target_organization_id, selected.category_id, (selected.ordinality - 1)::integer
  from unnest(selected_category_ids) with ordinality as selected(category_id, ordinality);

  insert into public.smart_menu_products (smart_menu_id, organization_id, product_id, sort_order)
  select target_menu_id, target_organization_id, selected.product_id, (selected.ordinality - 1)::integer
  from unnest(selected_product_ids) with ordinality as selected(product_id, ordinality);

  perform private.write_audit_log(
    target_organization_id,
    'SMART_MENU_UPDATED',
    'settings.manage',
    actor_employee_id,
    null,
    target_store_id,
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'smart_menu_id', target_menu_id,
      'is_enabled', target_is_enabled,
      'category_count', cardinality(selected_category_ids),
      'product_count', cardinality(selected_product_ids),
      'show_prices', target_show_prices,
      'show_images', target_show_images,
      'show_unavailable', target_show_unavailable,
      'show_variants', target_show_variants,
      'show_modifiers', target_show_modifiers
    )
  );

  return target_menu_id;
end;
$$;

-- This is the only public Smart Menu data path. It intentionally excludes
-- identifiers, costs, inventory counts, employee/store configuration, and
-- any product that is not explicitly selected for an enabled menu.
create function public.get_public_smart_menu(target_menu_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'menu_id', menu.id,
    'business_name', organization.name,
    'store_name', store.name,
    'currency_code', organization.currency_code,
    'show_prices', menu.show_prices,
    'show_images', menu.show_images,
    'show_variants', menu.show_variants,
    'show_modifiers', menu.show_modifiers,
    'categories', coalesce(
      (
        select jsonb_agg(category_payload order by category_sort_order, lower(category_name))
        from (
          select
            menu_category.sort_order as category_sort_order,
            category.name as category_name,
            jsonb_build_object(
              'id', category.id,
              'name', category.name,
              'products', coalesce(
                (
                  select jsonb_agg(product_payload order by product_sort_order, lower(product_name))
                  from (
                    select
                      menu_product.sort_order as product_sort_order,
                      product.name as product_name,
                      jsonb_build_object(
                        'id', product.id,
                        'name', product.name,
                        'description', product.description,
                        'image_url', case when menu.show_images then product.image_url else null end,
                        'price_minor', case
                          when menu.show_prices then coalesce(store_setting.price_override_minor, product.price_minor)
                          else null
                        end,
                        'is_variable_price', product.is_variable_price,
                        'available', store_setting.is_available,
                        'variants', case
                          when menu.show_variants then coalesce(
                            (
                              select jsonb_agg(
                                jsonb_build_object(
                                  'id', variant.id,
                                  'name', variant.name,
                                  'price_minor', case when menu.show_prices then variant.price_minor else null end
                                )
                                order by variant.sort_order, lower(variant.name)
                              )
                              from public.product_variants variant
                              where variant.organization_id = menu.organization_id
                                and variant.product_id = product.id
                                and variant.is_active
                            ),
                            '[]'::jsonb
                          )
                          else '[]'::jsonb
                        end,
                        'modifier_groups', case
                          when menu.show_modifiers then coalesce(
                            (
                              select jsonb_agg(
                                jsonb_build_object(
                                  'id', modifier_group.id,
                                  'name', modifier_group.name,
                                  'min_selections', modifier_group.min_selections,
                                  'max_selections', modifier_group.max_selections,
                                  'options', coalesce(
                                    (
                                      select jsonb_agg(
                                        jsonb_build_object(
                                          'id', modifier_option.id,
                                          'name', modifier_option.name,
                                          'price_minor', case when menu.show_prices then modifier_option.price_adjustment_minor else null end
                                        )
                                        order by modifier_option.sort_order, lower(modifier_option.name)
                                      )
                                      from public.modifier_options modifier_option
                                      where modifier_option.organization_id = menu.organization_id
                                        and modifier_option.modifier_group_id = modifier_group.id
                                        and modifier_option.is_active
                                    ),
                                    '[]'::jsonb
                                  )
                                )
                                order by assignment.sort_order, lower(modifier_group.name)
                              )
                              from public.product_modifier_groups assignment
                              join public.modifier_groups modifier_group
                                on modifier_group.id = assignment.modifier_group_id
                               and modifier_group.organization_id = assignment.organization_id
                               and modifier_group.is_active
                              where assignment.organization_id = menu.organization_id
                                and assignment.product_id = product.id
                            ),
                            '[]'::jsonb
                          )
                          else '[]'::jsonb
                        end
                      ) as product_payload
                    from public.smart_menu_products menu_product
                    join public.products product
                      on product.id = menu_product.product_id
                     and product.organization_id = menu_product.organization_id
                     and product.status = 'active'
                     and not product.is_composite
                     and product.category_id = category.id
                    join public.product_store_settings store_setting
                      on store_setting.organization_id = product.organization_id
                     and store_setting.product_id = product.id
                     and store_setting.store_id = menu.store_id
                    where menu_product.smart_menu_id = menu.id
                      and (menu.show_unavailable or store_setting.is_available)
                  ) selected_products
                ),
                '[]'::jsonb
              )
            ) as category_payload
          from public.smart_menu_categories menu_category
          join public.categories category
            on category.id = menu_category.category_id
           and category.organization_id = menu_category.organization_id
           and not category.is_archived
          where menu_category.smart_menu_id = menu.id
            and exists (
              select 1
              from public.smart_menu_products menu_product
              join public.products product
                on product.id = menu_product.product_id
               and product.organization_id = menu_product.organization_id
               and product.status = 'active'
               and not product.is_composite
               and product.category_id = category.id
              join public.product_store_settings store_setting
                on store_setting.organization_id = product.organization_id
               and store_setting.product_id = product.id
               and store_setting.store_id = menu.store_id
              where menu_product.smart_menu_id = menu.id
                and (menu.show_unavailable or store_setting.is_available)
            )
        ) selected_categories
      ),
      '[]'::jsonb
    )
  )
  from public.smart_menus menu
  join public.organizations organization
    on organization.id = menu.organization_id
   and organization.status = 'active'
  join public.stores store
    on store.id = menu.store_id
   and store.organization_id = menu.organization_id
   and store.is_active
  where menu.id = target_menu_id
    and menu.is_enabled;
$$;

revoke execute on function public.save_smart_menu_configuration(uuid, boolean, boolean, boolean, boolean, boolean, boolean, uuid[], uuid[])
from public, anon, service_role;
grant execute on function public.save_smart_menu_configuration(uuid, boolean, boolean, boolean, boolean, boolean, boolean, uuid[], uuid[])
to authenticated;

revoke execute on function public.get_public_smart_menu(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_public_smart_menu(uuid)
to anon, authenticated;

comment on table public.smart_menus is 'Store-scoped display configuration for the view-only public Smart Menu. It never owns product master data.';
comment on table public.smart_menu_categories is 'Explicit Smart Menu category selections and ordering. Product/category truth remains in the catalog.';
comment on table public.smart_menu_products is 'Explicit Smart Menu product selections and ordering. Product truth remains in the catalog.';
comment on function public.get_public_smart_menu(uuid) is 'Narrow anonymous Smart Menu projection for an enabled menu. It exposes no internal catalog, inventory, employee, or configuration data.';

notify pgrst, 'reload schema';

commit;
