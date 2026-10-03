begin;

-- purchase_order_lines intentionally uses a column-level authenticated SELECT
-- allowlist so unit_cost_minor remains protected behind the permission-checked
-- get_purchase_order_line_costs(...) RPC.
--
-- purchase_unit_code_snapshot and purchase_unit_factor_to_base were added
-- later as immutable operational receiving snapshots. The Purchasing /
-- Receiving server loader requires them to render and post quantities in the
-- locked purchase unit, but they are not cost fields.
grant select (
  purchase_unit_code_snapshot,
  purchase_unit_factor_to_base
)
on table public.purchase_order_lines
to authenticated;

comment on column public.purchase_order_lines.purchase_unit_code_snapshot is
  'Immutable purchase-unit code snapshot required for operational purchase-order and receiving reads.';

comment on column public.purchase_order_lines.purchase_unit_factor_to_base is
  'Immutable purchase-unit conversion snapshot required for operational receiving quantity conversion; not a cost field.';

commit;
