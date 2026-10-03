begin;

alter table public.sale_items
  drop constraint sale_items_total_math,
  add constraint sale_items_total_math check (
    line_total_minor = round(
      unit_price_minor::numeric * quantity - discount_minor::numeric + tax_minor::numeric
    )::bigint
  );

commit;
