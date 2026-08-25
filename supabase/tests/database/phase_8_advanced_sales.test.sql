begin;

create extension if not exists pgtap with schema extensions;
select plan(16);

select has_table('public', 'discounts', 'discounts table exists');
select has_table('public', 'tax_rates', 'tax rates table exists');
select has_table('public', 'dining_options', 'dining options table exists');
select has_table('public', 'modifier_groups', 'modifier groups table exists');
select has_table('public', 'modifier_options', 'modifier options table exists');
select has_table('public', 'product_modifier_groups', 'product modifier assignments exist');
select has_table('public', 'open_tickets', 'open tickets table exists');
select has_table('public', 'advanced_checkout_requests', 'advanced checkout idempotency table exists');
select is((select count(*) from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace where namespace.nspname = 'public' and relation.relname in ('discounts','tax_rates','dining_options','modifier_groups','modifier_options','product_modifier_groups','open_tickets','advanced_checkout_requests') and relation.relrowsecurity), 8::bigint, 'RLS is enabled on every Phase 8 table');
select has_column('public', 'sales', 'tax_is_inclusive', 'sales preserve the tax calculation mode');
select has_column('public', 'sales', 'open_ticket_id', 'sales retain their completed ticket source');
select has_column('public', 'sale_items', 'modifiers_snapshot', 'sale lines preserve modifier snapshots');
select ok(to_regprocedure('public.get_pos_product_modifiers(uuid,uuid)') is not null, 'POS modifier lookup exists');
select ok(to_regprocedure('public.save_open_ticket(uuid,uuid,uuid,uuid,uuid,uuid,text,text,jsonb)') is not null, 'open ticket save routine exists');
select ok(to_regprocedure('public.cancel_open_ticket(uuid,uuid)') is not null, 'open ticket cancellation routine exists');
select ok(to_regprocedure('public.checkout_advanced_sale(uuid,uuid,uuid,uuid,jsonb,jsonb,uuid,integer,uuid,uuid,uuid,uuid)') is not null, 'advanced checkout routine exists');

select * from finish();
rollback;
