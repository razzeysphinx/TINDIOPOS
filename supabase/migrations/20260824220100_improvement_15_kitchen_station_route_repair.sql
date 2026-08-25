-- Repair the Phase 15 upsert routine for databases that applied the initial
-- migration before the output-column ambiguity was corrected.
begin;

create or replace function private.set_kitchen_station_category_route(
  target_organization_id uuid,
  target_category_id uuid,
  target_station text
)
returns table (category_id uuid, station text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'kitchen.manage')) then
    raise exception 'Kitchen order management access is required.' using errcode = '42501';
  end if;

  if target_station not in ('KITCHEN', 'BAR', 'DESSERT') then
    raise exception 'Choose a valid kitchen station.' using errcode = '22023';
  end if;

  select employee.id into actor_employee_id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active';

  if actor_employee_id is null or not exists (
    select 1
    from public.categories category
    where category.id = target_category_id
      and category.organization_id = target_organization_id
      and not category.is_archived
  ) then
    raise exception 'This category is unavailable for kitchen routing.' using errcode = 'P0002';
  end if;

  return query
  insert into public.kitchen_station_category_routes (
    organization_id, category_id, station, updated_by_employee_id
  )
  values (
    target_organization_id, target_category_id, target_station, actor_employee_id
  )
  on conflict on constraint kitchen_station_category_routes_unique do update
  set station = excluded.station, updated_by_employee_id = excluded.updated_by_employee_id
  returning kitchen_station_category_routes.category_id, kitchen_station_category_routes.station;
end;
$$;

comment on function private.set_kitchen_station_category_route(uuid, uuid, text)
is 'Creates or updates an organization category station route for future kitchen snapshots.';

commit;
