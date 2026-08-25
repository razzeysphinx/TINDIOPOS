begin;

create extension if not exists pgtap with schema extensions;

select plan(32);

select has_table('public', 'ticket_templates', 'ticket templates table exists');
select has_column('public', 'open_tickets', 'assigned_employee_id', 'tickets retain their assigned employee');
select has_column('public', 'open_tickets', 'merged_into_ticket_id', 'merged tickets retain their destination');
select has_column('public', 'sale_items', 'item_note', 'sale items preserve immutable item notes');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.ticket_templates'::regclass), 'RLS is enabled on ticket templates');
select ok(to_regprocedure('public.save_open_ticket_v2(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,jsonb)') is not null, 'assigned-ticket save routine exists');
select ok(to_regprocedure('public.get_pos_open_tickets(uuid,uuid,uuid)') is not null, 'safe POS open-ticket lookup exists');
select ok(to_regprocedure('public.move_open_ticket_lines(uuid,uuid,uuid,jsonb)') is not null, 'ticket-line move routine exists');
select ok(to_regprocedure('public.split_open_ticket(uuid,uuid,text,jsonb)') is not null, 'ticket split routine exists');
select ok(to_regprocedure('public.merge_open_tickets(uuid,uuid,uuid)') is not null, 'ticket merge routine exists');

insert into auth.users (id, email, raw_user_meta_data)
values ('91919191-9191-4919-8919-919191919191', 'ticket-owner@tindio.test', '{"full_name":"Ticket Owner"}'::jsonb);

create temporary table ticket_workflow_context (
  organization_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  employee_id uuid,
  product_id uuid,
  source_ticket_id uuid,
  destination_ticket_id uuid,
  split_ticket_id uuid,
  checkout_sale_id uuid
);
grant select, insert, update on ticket_workflow_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '91919191-9191-4919-8919-919191919191';

insert into ticket_workflow_context (organization_id, store_id, register_id)
select organization_id, store_id, register_id
from public.bootstrap_organization('Ticket Workflow Retail', 'Ticket Workflow Main', 'Ticket Workflow Counter');

update ticket_workflow_context
set employee_id = employee.id
from public.employees employee
where employee.organization_id = ticket_workflow_context.organization_id
  and employee.profile_id = '91919191-9191-4919-8919-919191919191';

insert into public.ticket_templates (organization_id, created_by_employee_id, label, note)
select organization_id, employee_id, 'Table 1', 'Preset for table one'
from ticket_workflow_context;

select is((select count(*) from public.ticket_templates), 1::bigint, 'authorized manager can create a predefined ticket template');

select lives_ok(
  format(
    $$select public.open_register_shift(%L, %L, %L, 0, null)$$,
    (select organization_id from ticket_workflow_context),
    (select store_id from ticket_workflow_context),
    (select register_id from ticket_workflow_context)
  ),
  'owner opens the register shift before ticket work'
);

update ticket_workflow_context
set product_id = public.create_catalog_product(
  organization_id,
  null,
  'Ticket workflow item',
  'Untracked test item',
  'simple',
  'TICKET-WORKFLOW-ITEM',
  '480000080008',
  1000,
  0,
  false,
  'each',
  array[store_id],
  '[]'::jsonb
);

select lives_ok(
  format(
    $$select * from public.save_open_ticket_v2(%L, %L, %L, null, null, null, null, 'Table A', 'Allergy on one line', jsonb_build_array(
      jsonb_build_object('product_id', %L::uuid, 'variant_id', null, 'quantity', 1, 'ticket_line_id', 'a1000000-0000-4000-8000-000000000001', 'item_note', 'No ice'),
      jsonb_build_object('product_id', %L::uuid, 'variant_id', null, 'quantity', 1, 'ticket_line_id', 'a1000000-0000-4000-8000-000000000002'),
      jsonb_build_object('product_id', %L::uuid, 'variant_id', null, 'quantity', 1, 'ticket_line_id', 'a1000000-0000-4000-8000-000000000003')
    ))$$,
    (select organization_id from ticket_workflow_context),
    (select store_id from ticket_workflow_context),
    (select register_id from ticket_workflow_context),
    (select product_id from ticket_workflow_context),
    (select product_id from ticket_workflow_context),
    (select product_id from ticket_workflow_context)
  ),
  'assigned-ticket save accepts item notes and line references'
);

update ticket_workflow_context
set source_ticket_id = ticket.id
from public.open_tickets ticket
where ticket.organization_id = ticket_workflow_context.organization_id
  and ticket.label = 'Table A';

select is(
  (select assigned_employee_id from public.open_tickets where id = (select source_ticket_id from ticket_workflow_context)),
  (select employee_id from ticket_workflow_context),
  'a ticket defaults to the employee operating the active shift'
);
select is(
  (select cart -> 0 ->> 'item_note' from public.open_tickets where id = (select source_ticket_id from ticket_workflow_context)),
  'No ice',
  'ticket item notes are saved with the held ticket'
);
select ok(
  (select cart -> 0 ->> 'ticket_line_id' from public.open_tickets where id = (select source_ticket_id from ticket_workflow_context)) ~* '^[0-9a-f-]{36}$',
  'saved ticket lines have stable ticket references'
);

update ticket_workflow_context context
set destination_ticket_id = ticket.ticket_id
from public.save_open_ticket_v2(
  (select organization_id from ticket_workflow_context),
  (select store_id from ticket_workflow_context),
  (select register_id from ticket_workflow_context),
  null,
  null,
  null,
  null,
  'Table B',
  null,
  jsonb_build_array(jsonb_build_object(
    'product_id', (select product_id from ticket_workflow_context),
    'variant_id', null,
    'quantity', 1,
    'ticket_line_id', 'a1000000-0000-4000-8000-000000000004'
  ))
) ticket;

select ok((select destination_ticket_id from ticket_workflow_context) is not null, 'a destination ticket can be created');

select lives_ok(
  format(
    $$select public.move_open_ticket_lines(%L, %L, %L, jsonb_build_array(jsonb_build_object('ticket_line_id', 'a1000000-0000-4000-8000-000000000001', 'quantity', 1)))$$,
    (select organization_id from ticket_workflow_context),
    (select source_ticket_id from ticket_workflow_context),
    (select destination_ticket_id from ticket_workflow_context)
  ),
  'selected ticket items move atomically between tickets'
);
select is((select jsonb_array_length(cart) from public.open_tickets where id = (select source_ticket_id from ticket_workflow_context)), 2, 'move removes the selected line from the source ticket');
select is((select jsonb_array_length(cart) from public.open_tickets where id = (select destination_ticket_id from ticket_workflow_context)), 2, 'move adds the selected line to the destination ticket');

update ticket_workflow_context context
set split_ticket_id = split.ticket_id
from (
  select public.split_open_ticket(
    (select organization_id from ticket_workflow_context),
    (select source_ticket_id from ticket_workflow_context),
    'Table A - Split',
    jsonb_build_array(jsonb_build_object('ticket_line_id', 'a1000000-0000-4000-8000-000000000002', 'quantity', 1))
  ) as ticket_id
) split;

select ok((select split_ticket_id from ticket_workflow_context) is not null, 'splitting a ticket creates a distinct open ticket');
select is((select jsonb_array_length(cart) from public.open_tickets where id = (select source_ticket_id from ticket_workflow_context)), 1, 'split leaves the remaining source items intact');
select is((select jsonb_array_length(cart) from public.open_tickets where id = (select split_ticket_id from ticket_workflow_context)), 1, 'split ticket receives only the selected items');

select lives_ok(
  format(
    $$select public.merge_open_tickets(%L, %L, %L)$$,
    (select organization_id from ticket_workflow_context),
    (select split_ticket_id from ticket_workflow_context),
    (select destination_ticket_id from ticket_workflow_context)
  ),
  'open tickets merge atomically'
);
select is((select status from public.open_tickets where id = (select split_ticket_id from ticket_workflow_context)), 'merged', 'merged source ticket remains traceable instead of being deleted');
select is((select merged_into_ticket_id from public.open_tickets where id = (select split_ticket_id from ticket_workflow_context)), (select destination_ticket_id from ticket_workflow_context), 'merged ticket retains its destination relationship');
select is((select jsonb_array_length(cart) from public.open_tickets where id = (select destination_ticket_id from ticket_workflow_context)), 3, 'merge moves every source item into the destination ticket');
select ok(
  exists (
    select 1 from public.audit_logs audit
    where audit.organization_id = (select organization_id from ticket_workflow_context)
      and audit.event_type in ('OPEN_TICKET_LINES_MOVED', 'OPEN_TICKET_SPLIT', 'OPEN_TICKETS_MERGED')
  ),
  'ticket reallocation operations produce audit events'
);
select is(
  (
    select count(*)
    from public.get_pos_open_tickets(
      (select organization_id from ticket_workflow_context),
      (select store_id from ticket_workflow_context),
      (select register_id from ticket_workflow_context)
    )
  ),
  2::bigint,
  'POS lookup returns only the two currently open tickets'
);

update ticket_workflow_context context
set checkout_sale_id = checkout.sale_id
from public.checkout_advanced_sale(
  (select organization_id from ticket_workflow_context),
  (select store_id from ticket_workflow_context),
  (select register_id from ticket_workflow_context),
  'a1000000-0000-4000-8000-000000000099',
  jsonb_build_array(jsonb_build_object(
    'product_id', (select product_id from ticket_workflow_context),
    'variant_id', null,
    'quantity', 1,
    'modifier_option_ids', '[]'::jsonb,
    'item_note', 'No ice'
  )),
  jsonb_build_array(jsonb_build_object(
    'payment_method_id', (select id from public.payment_methods where organization_id = (select organization_id from ticket_workflow_context) and code = 'CASH'),
    'amount_tendered_minor', 1000
  )),
  null,
  0,
  null,
  null,
  null,
  (select source_ticket_id from ticket_workflow_context)
) checkout;

select ok((select checkout_sale_id from ticket_workflow_context) is not null, 'advanced checkout completes an open ticket with item notes');
select is((select status from public.open_tickets where id = (select source_ticket_id from ticket_workflow_context)), 'completed', 'checkout completes its source ticket');
select is((select item_note from public.sale_items where sale_id = (select checkout_sale_id from ticket_workflow_context)), 'No ice', 'advanced checkout snapshots the item note on the sale line');

select * from finish();
rollback;
