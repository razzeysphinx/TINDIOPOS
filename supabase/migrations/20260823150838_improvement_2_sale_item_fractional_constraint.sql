begin;

alter table public.sale_items
  drop constraint sale_items_quantity_bounds,
  add constraint sale_items_quantity_bounds check (
    quantity >= 0.001 and quantity <= 10000
  );

commit;
