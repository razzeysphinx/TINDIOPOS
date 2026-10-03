-- TINDIO Phase 12: organization revision stream. This starts at installation; it deliberately has no history backfill.
begin;

create table public.pos_sync_changes (
  revision bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid,
  domain text not null check (domain in ('CATALOG','REFERENCE','CUSTOMER','DEVICE','MODIFIERS')),
  entity_id uuid,
  operation text not null check (operation in ('UPSERT','DELETE','INVALIDATE')),
  changed_at timestamptz not null default now(),
  foreign key (store_id, organization_id) references public.stores(id, organization_id) on delete cascade
);
create index pos_sync_changes_org_revision_idx on public.pos_sync_changes(organization_id, revision);
create index pos_sync_changes_org_store_revision_idx on public.pos_sync_changes(organization_id, store_id, revision);
alter table public.pos_sync_changes enable row level security;
revoke all on table public.pos_sync_changes from public, anon, authenticated, service_role;

create or replace function private.record_pos_sync_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare payload jsonb; operation_value text; store_value uuid; entity_value uuid;
begin
  payload := case when TG_OP='DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
  operation_value := case when TG_ARGV[3]='INVALIDATE' then 'INVALIDATE' when TG_OP='DELETE' then 'DELETE' else 'UPSERT' end;
  entity_value := nullif(payload ->> TG_ARGV[1], '')::uuid;
  store_value := case when coalesce(TG_ARGV[2],'')='' then null else nullif(payload ->> TG_ARGV[2], '')::uuid end;
  insert into public.pos_sync_changes(organization_id,store_id,domain,entity_id,operation)
  values ((payload ->> 'organization_id')::uuid,store_value,TG_ARGV[0],entity_value,operation_value);
  return coalesce(NEW, OLD);
end;
$$;

create trigger pos_sync_products after insert or update or delete on public.products for each row execute function private.record_pos_sync_change('CATALOG','id','','UPSERT');
create trigger pos_sync_product_variants after insert or update or delete on public.product_variants for each row execute function private.record_pos_sync_change('CATALOG','product_id','','UPSERT');
create trigger pos_sync_product_store_settings after insert or update or delete on public.product_store_settings for each row execute function private.record_pos_sync_change('CATALOG','product_id','store_id','UPSERT');
create trigger pos_sync_categories after insert or update or delete on public.categories for each row execute function private.record_pos_sync_change('REFERENCE','id','','UPSERT');
create trigger pos_sync_payment_methods after insert or update or delete on public.payment_methods for each row execute function private.record_pos_sync_change('REFERENCE','id','','UPSERT');
create trigger pos_sync_store_payment_methods after insert or update or delete on public.store_payment_methods for each row execute function private.record_pos_sync_change('REFERENCE','payment_method_id','store_id','UPSERT');
create trigger pos_sync_loyalty_programs after insert or update or delete on public.loyalty_programs for each row execute function private.record_pos_sync_change('REFERENCE','organization_id','','UPSERT');
create trigger pos_sync_discounts after insert or update or delete on public.discounts for each row execute function private.record_pos_sync_change('REFERENCE','id','','UPSERT');
create trigger pos_sync_tax_rates after insert or update or delete on public.tax_rates for each row execute function private.record_pos_sync_change('REFERENCE','id','','UPSERT');
create trigger pos_sync_dining_options after insert or update or delete on public.dining_options for each row execute function private.record_pos_sync_change('REFERENCE','id','','UPSERT');
create trigger pos_sync_ticket_templates after insert or update or delete on public.ticket_templates for each row execute function private.record_pos_sync_change('REFERENCE','id','','UPSERT');
create trigger pos_sync_customers after insert or update or delete on public.customers for each row execute function private.record_pos_sync_change('CUSTOMER','id','','UPSERT');
create trigger pos_sync_devices after insert or update or delete on public.pos_devices for each row execute function private.record_pos_sync_change('DEVICE','id','store_id','UPSERT');
create trigger pos_sync_modifier_groups after insert or update or delete on public.modifier_groups for each row execute function private.record_pos_sync_change('MODIFIERS','id','','INVALIDATE');
create trigger pos_sync_modifier_options after insert or update or delete on public.modifier_options for each row execute function private.record_pos_sync_change('MODIFIERS','modifier_group_id','','INVALIDATE');
create trigger pos_sync_product_modifier_groups after insert or update or delete on public.product_modifier_groups for each row execute function private.record_pos_sync_change('MODIFIERS','product_id','','INVALIDATE');

create or replace function private.require_pos_sync_access(target_organization_id uuid,target_device_id uuid)
returns table(store_id uuid, register_id uuid) language plpgsql security definer set search_path = '' as $$
declare selected_store_id uuid; selected_register_id uuid;
begin
  select device.store_id,device.register_id into selected_store_id,selected_register_id from public.pos_devices device where device.organization_id=target_organization_id and device.id=target_device_id;
  perform private.require_pos_sequence_access(target_organization_id,target_device_id,selected_store_id,selected_register_id);
  return query select selected_store_id,selected_register_id;
end;
$$;

create or replace function public.get_pos_sync_revision(target_organization_id uuid,target_device_id uuid)
returns table(current_revision bigint) language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_pos_sync_access(target_organization_id,target_device_id);
  return query select coalesce(max(change.revision),0) from public.pos_sync_changes change where change.organization_id=target_organization_id;
end;
$$;

create or replace function public.get_pos_sync_change_window(target_organization_id uuid,target_device_id uuid,target_after_revision bigint,target_limit integer)
returns table(revision bigint,domain text,entity_id uuid,operation text,store_id uuid) language plpgsql security definer set search_path = '' as $$
declare selected_store_id uuid;
begin
  if target_after_revision is null or target_after_revision<0 or target_limit is null or target_limit not between 1 and 200 then raise exception 'Invalid sync cursor or limit.' using errcode='22023'; end if;
  select access.store_id into selected_store_id from private.require_pos_sync_access(target_organization_id,target_device_id) access;
  return query select change.revision,change.domain,change.entity_id,change.operation,change.store_id from public.pos_sync_changes change where change.organization_id=target_organization_id and change.revision>target_after_revision and (change.store_id is null or change.store_id=selected_store_id) order by change.revision asc limit target_limit+1;
end;
$$;

create or replace function public.get_pos_catalog_product_v2(target_organization_id uuid,target_store_id uuid,target_product_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare access_store_id uuid; catalog jsonb;
begin
  select access.store_id into access_store_id from private.require_pos_sync_access(target_organization_id,(current_setting('request.headers',true)::jsonb ->> 'x-tindio-pos-device-id')::uuid) access;
  if access_store_id is null or access_store_id<>target_store_id then raise exception 'Store access is required.' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('productId',item.product_id,'variantId',item.variant_id,'categoryId',item.category_id,'productName',item.product_name,'variantName',item.variant_name,'sku',item.sku,'barcode',item.barcode,'priceMinor',item.price_minor,'unit',item.unit,'imageUrl',item.image_url,'isVariablePrice',item.is_variable_price,'allowFractionalQuantity',item.allow_fractional_quantity,'hasModifiers',exists(select 1 from public.product_modifier_groups assignment where assignment.organization_id=target_organization_id and assignment.product_id=item.product_id))),'[]'::jsonb) into catalog from public.search_pos_catalog(target_organization_id,target_store_id,'',null,0,10000) item where item.product_id=target_product_id;
  return jsonb_build_object('organizationId',target_organization_id,'storeId',target_store_id,'productId',target_product_id,'items',catalog);
end;
$$;

create or replace function public.get_pos_sync_customer(target_organization_id uuid,target_device_id uuid,target_customer_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare customer jsonb;
begin
  perform private.require_pos_sync_access(target_organization_id,target_device_id);
  select jsonb_build_object('id',row.id,'customerNumber',row.customer_number,'loyaltyCardCode',row.loyalty_card_code,'fullName',row.full_name,'phone',row.phone,'email',row.email,'loyaltyPoints',coalesce((select sum(transaction.points_delta) from public.loyalty_transactions transaction where transaction.organization_id=row.organization_id and transaction.customer_id=row.id),0)) into customer from public.customers row where row.organization_id=target_organization_id and row.id=target_customer_id and row.status='active';
  return jsonb_build_object('customer',customer);
end;
$$;

revoke execute on function private.record_pos_sync_change() from public,anon,authenticated,service_role;
revoke execute on function private.require_pos_sync_access(uuid,uuid) from public,anon,authenticated,service_role;
revoke execute on function public.get_pos_sync_revision(uuid,uuid) from public,anon,service_role;
revoke execute on function public.get_pos_sync_change_window(uuid,uuid,bigint,integer) from public,anon,service_role;
revoke execute on function public.get_pos_catalog_product_v2(uuid,uuid,uuid) from public,anon,service_role;
revoke execute on function public.get_pos_sync_customer(uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.get_pos_sync_revision(uuid,uuid) to authenticated;
grant execute on function public.get_pos_sync_change_window(uuid,uuid,bigint,integer) to authenticated;
grant execute on function public.get_pos_catalog_product_v2(uuid,uuid,uuid) to authenticated;
grant execute on function public.get_pos_sync_customer(uuid,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
