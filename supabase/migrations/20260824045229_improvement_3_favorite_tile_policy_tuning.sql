begin;

-- Keep the read policy separate from management writes. `FOR ALL` also covers
-- SELECT and made the security advisor evaluate two permissive read policies.
drop policy pos_favorite_tiles_manage_catalog_users on public.pos_favorite_tiles;

create policy pos_favorite_tiles_insert_catalog_users
on public.pos_favorite_tiles
for insert
to authenticated
with check (
  (select private.has_permission(organization_id, 'products.manage'))
  and exists (
    select 1
    from public.employees employee
    join public.employee_stores employee_store
      on employee_store.employee_id = employee.id
     and employee_store.organization_id = employee.organization_id
    where employee.organization_id = pos_favorite_tiles.organization_id
      and employee.profile_id = (select auth.uid())
      and employee.status = 'active'
      and employee_store.store_id = pos_favorite_tiles.store_id
  )
);

create policy pos_favorite_tiles_update_catalog_users
on public.pos_favorite_tiles
for update
to authenticated
using (
  (select private.has_permission(organization_id, 'products.manage'))
  and exists (
    select 1
    from public.employees employee
    join public.employee_stores employee_store
      on employee_store.employee_id = employee.id
     and employee_store.organization_id = employee.organization_id
    where employee.organization_id = pos_favorite_tiles.organization_id
      and employee.profile_id = (select auth.uid())
      and employee.status = 'active'
      and employee_store.store_id = pos_favorite_tiles.store_id
  )
)
with check (
  (select private.has_permission(organization_id, 'products.manage'))
  and exists (
    select 1
    from public.employees employee
    join public.employee_stores employee_store
      on employee_store.employee_id = employee.id
     and employee_store.organization_id = employee.organization_id
    where employee.organization_id = pos_favorite_tiles.organization_id
      and employee.profile_id = (select auth.uid())
      and employee.status = 'active'
      and employee_store.store_id = pos_favorite_tiles.store_id
  )
);

create policy pos_favorite_tiles_delete_catalog_users
on public.pos_favorite_tiles
for delete
to authenticated
using (
  (select private.has_permission(organization_id, 'products.manage'))
  and exists (
    select 1
    from public.employees employee
    join public.employee_stores employee_store
      on employee_store.employee_id = employee.id
     and employee_store.organization_id = employee.organization_id
    where employee.organization_id = pos_favorite_tiles.organization_id
      and employee.profile_id = (select auth.uid())
      and employee.status = 'active'
      and employee_store.store_id = pos_favorite_tiles.store_id
  )
);

commit;
