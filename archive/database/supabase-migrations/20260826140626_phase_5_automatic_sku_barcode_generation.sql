-- TINDIO Planning Phase 5: collision-safe internal product identifiers.
--
-- This adds a generator only. Products and variants continue to own their
-- nullable SKU/barcode fields, their organization-scoped indexes, and the
-- existing cross-table identifier trigger. Archived identifiers are therefore
-- not recycled.

begin;

create or replace function private.generate_catalog_identifiers(
  target_organization_id uuid,
  target_product_name text
)
returns table (sku text, barcode text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text;
  name_token text;
  identifier_suffix text;
  candidate_sku text;
  candidate_barcode text;
  attempt integer;
begin
  if not coalesce(
    (select private.has_permission(target_organization_id, 'products.manage')),
    false
  ) then
    raise exception 'Product management permission is required.' using errcode = '42501';
  end if;

  normalized_name := btrim(coalesce(target_product_name, ''));
  if normalized_name = '' or char_length(normalized_name) > 160 then
    raise exception 'Enter a product name between 1 and 160 characters.' using errcode = '22023';
  end if;

  name_token := regexp_replace(upper(normalized_name), '[^A-Z0-9]+', '-', 'g');
  name_token := regexp_replace(name_token, '(^-+|-+$)', '', 'g');
  name_token := left(nullif(name_token, ''), 20);
  name_token := coalesce(name_token, 'ITEM');

  for attempt in 1..20 loop
    identifier_suffix := upper(left(replace(gen_random_uuid()::text, '-', ''), 8));
    candidate_sku := format('TND-%s-%s', name_token, identifier_suffix);
    candidate_barcode := format('TND-%s', identifier_suffix);

    if not exists (
      select 1
      from public.products product
      where product.organization_id = target_organization_id
        and (
          product.sku = any(array[candidate_sku, candidate_barcode])
          or product.barcode = any(array[candidate_sku, candidate_barcode])
        )
    ) and not exists (
      select 1
      from public.product_variants variant
      where variant.organization_id = target_organization_id
        and (
          variant.sku = any(array[candidate_sku, candidate_barcode])
          or variant.barcode = any(array[candidate_sku, candidate_barcode])
        )
    ) then
      return query select candidate_sku, candidate_barcode;
      return;
    end if;
  end loop;

  raise exception 'TINDIO could not generate a unique product identifier. Please try again.'
    using errcode = '23505';
end;
$$;

revoke execute on function private.generate_catalog_identifiers(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function private.generate_catalog_identifiers(uuid, text) to authenticated;

create or replace function public.generate_catalog_identifiers(
  target_organization_id uuid,
  target_product_name text
)
returns table (sku text, barcode text)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.generate_catalog_identifiers(
    target_organization_id,
    target_product_name
  );
$$;

revoke execute on function public.generate_catalog_identifiers(uuid, text)
from public, anon, service_role;
grant execute on function public.generate_catalog_identifiers(uuid, text) to authenticated;

comment on function public.generate_catalog_identifiers(uuid, text)
is 'Returns collision-checked TINDIO SKU and Code 39-compatible barcode candidates for a product. The catalog write remains protected by its existing identifier uniqueness guard.';

commit;
