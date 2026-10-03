-- TINDIO Planning Document Phase 7: keep Smart Menu read and write policies
-- separate. This is an additive repair for databases that already applied the
-- initial Phase 7 migration; new databases also reach the same final policy
-- shape without overlapping permissive SELECT policies.

begin;

drop policy if exists smart_menus_write_settings_manager on public.smart_menus;
drop policy if exists smart_menus_insert_settings_manager on public.smart_menus;
drop policy if exists smart_menus_update_settings_manager on public.smart_menus;
drop policy if exists smart_menus_delete_settings_manager on public.smart_menus;

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

drop policy if exists smart_menu_categories_write_settings_manager on public.smart_menu_categories;
drop policy if exists smart_menu_categories_insert_settings_manager on public.smart_menu_categories;
drop policy if exists smart_menu_categories_update_settings_manager on public.smart_menu_categories;
drop policy if exists smart_menu_categories_delete_settings_manager on public.smart_menu_categories;

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

drop policy if exists smart_menu_products_write_settings_manager on public.smart_menu_products;
drop policy if exists smart_menu_products_insert_settings_manager on public.smart_menu_products;
drop policy if exists smart_menu_products_update_settings_manager on public.smart_menu_products;
drop policy if exists smart_menu_products_delete_settings_manager on public.smart_menu_products;

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

notify pgrst, 'reload schema';

commit;
