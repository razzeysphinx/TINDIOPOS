-- Keep Phase 8 configuration reads in one permissive policy per table.
-- Separate mutation policies avoid RLS policy-per-row overhead on POS reads.
begin;

drop policy discounts_manage_authorized on public.discounts;
drop policy tax_rates_manage_authorized on public.tax_rates;
drop policy dining_options_manage_authorized on public.dining_options;
drop policy modifier_groups_manage_authorized on public.modifier_groups;
drop policy modifier_options_manage_authorized on public.modifier_options;
drop policy product_modifier_groups_manage_authorized on public.product_modifier_groups;

create policy discounts_insert_authorized on public.discounts for insert to authenticated with check ((select private.has_permission(organization_id, 'products.manage')));
create policy discounts_update_authorized on public.discounts for update to authenticated using ((select private.has_permission(organization_id, 'products.manage'))) with check ((select private.has_permission(organization_id, 'products.manage')));
create policy tax_rates_insert_authorized on public.tax_rates for insert to authenticated with check ((select private.has_permission(organization_id, 'products.manage')));
create policy tax_rates_update_authorized on public.tax_rates for update to authenticated using ((select private.has_permission(organization_id, 'products.manage'))) with check ((select private.has_permission(organization_id, 'products.manage')));
create policy dining_options_insert_authorized on public.dining_options for insert to authenticated with check ((select private.has_permission(organization_id, 'products.manage')));
create policy dining_options_update_authorized on public.dining_options for update to authenticated using ((select private.has_permission(organization_id, 'products.manage'))) with check ((select private.has_permission(organization_id, 'products.manage')));
create policy modifier_groups_insert_authorized on public.modifier_groups for insert to authenticated with check ((select private.has_permission(organization_id, 'products.manage')));
create policy modifier_groups_update_authorized on public.modifier_groups for update to authenticated using ((select private.has_permission(organization_id, 'products.manage'))) with check ((select private.has_permission(organization_id, 'products.manage')));
create policy modifier_options_insert_authorized on public.modifier_options for insert to authenticated with check ((select private.has_permission(organization_id, 'products.manage')));
create policy modifier_options_update_authorized on public.modifier_options for update to authenticated using ((select private.has_permission(organization_id, 'products.manage'))) with check ((select private.has_permission(organization_id, 'products.manage')));
create policy product_modifier_groups_insert_authorized on public.product_modifier_groups for insert to authenticated with check ((select private.has_permission(organization_id, 'products.manage')));
create policy product_modifier_groups_update_authorized on public.product_modifier_groups for update to authenticated using ((select private.has_permission(organization_id, 'products.manage'))) with check ((select private.has_permission(organization_id, 'products.manage')));

commit;
