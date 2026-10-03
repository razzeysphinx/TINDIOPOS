alter table "public"."product_units"
  drop constraint "product_units_code_format";

alter table "public"."product_units"
  add constraint "product_units_code_format" check (((unit_code = lower(TRIM(BOTH FROM unit_code))) AND (unit_code ~ '^[a-z0-9][a-z0-9 _-]{0,23}$'::text)));

