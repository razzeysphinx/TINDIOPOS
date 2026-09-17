begin;

create extension if not exists pgtap with schema extensions;
select plan(24);

select col_default_is('public', 'inventory_counts', 'status', 'draft', 'new count documents default to the canonical draft state');
select ok(
  pg_get_constraintdef((select oid from pg_constraint where conname = 'inventory_counts_status_values')) like '%open%completed%',
  'legacy open/completed values remain readable compatibility states'
);
select has_trigger('public', 'inventory_counts', 'inventory_counts_guard_canonical_lifecycle', 'count lifecycle has a database guard');
select has_trigger('public', 'inventory_count_lines', 'inventory_count_lines_guard_terminal_document', 'terminal count lines have an immutability guard');
select has_trigger('public', 'inventory_count_lines', 'inventory_count_lines_audit_physical_quantity', 'physical count saves produce audit evidence');

select ok(
  pg_get_functiondef('private.guard_inventory_count_lifecycle()'::regprocedure) like '%Legacy inventory count states are read-only compatibility evidence.%',
  'legacy states cannot be newly written'
);
select ok(
  pg_get_functiondef('private.guard_inventory_count_lifecycle()'::regprocedure) like '%Posted inventory counts are immutable.%',
  'posted and completed count documents are immutable'
);
select ok(
  pg_get_functiondef('private.guard_inventory_count_line_lifecycle()'::regprocedure) like '%posted%completed%cancelled%',
  'terminal document lines are immutable'
);
select ok(
  pg_get_functiondef('private.audit_inventory_count_line_saved()'::regprocedure) like '%INVENTORY_COUNT_LINE_SAVED%',
  'manual and imported physical quantities retain immutable audit evidence'
);
select ok(
  pg_get_functiondef('private.cancel_inventory_count(uuid,uuid,text)'::regprocedure) like $$%status not in ('draft', 'in_progress', 'ready_for_review')%$$,
  'cancellation accepts only canonical active states'
);

select ok(not has_function_privilege('authenticated', 'private.create_inventory_count_draft(uuid,uuid,text)', 'execute'), 'authenticated cannot execute the superseded draft writer');
select ok(not has_function_privilege('authenticated', 'private.complete_inventory_count(uuid,uuid,text,jsonb)', 'execute'), 'authenticated cannot execute the superseded one-step completion writer');
select ok(not has_function_privilege('authenticated', 'private.post_inventory_count(uuid,uuid)', 'execute'), 'authenticated cannot bypass operation-aware count posting');
select ok(not has_function_privilege('anon', 'public.post_inventory_count(uuid,uuid,uuid)', 'execute'), 'anonymous callers cannot post counts');
select ok(has_function_privilege('authenticated', 'public.post_inventory_count(uuid,uuid,uuid)', 'execute'), 'authenticated callers reach the canonical operation-aware posting command');
select ok(to_regprocedure('public.post_inventory_count(uuid,uuid)') is null, 'the superseded public non-idempotent post signature is absent');

select ok(
  pg_get_functiondef('private.post_inventory_count(uuid,uuid)'::regprocedure) like '%reconciled_expected_quantity%'
  and pg_get_functiondef('private.post_inventory_count(uuid,uuid)'::regprocedure) like '%private.apply_inventory_change_v2%'
  and pg_get_functiondef('private.post_inventory_count(uuid,uuid)'::regprocedure) like $$%'COUNT'%$$,
  'one canonical posting engine owns reconciled COUNT ledger mutations'
);
select ok(
  pg_get_functiondef('private.post_inventory_count_idempotent(uuid,uuid,uuid)'::regprocedure) like '%post_operation_id%'
  and pg_get_functiondef('private.post_inventory_count_idempotent(uuid,uuid,uuid)'::regprocedure) like '%for update%',
  'posting reserves operation identity while holding the count lock'
);
select has_index('public', 'inventory_counts', 'inventory_counts_organization_post_operation_id_key', 'count post operation IDs are unique per organization');

select ok(
  pg_get_functiondef('private.save_inventory_count_line(uuid,uuid,uuid,uuid,numeric)'::regprocedure) like '%for update%'
  and pg_get_functiondef('private.save_inventory_count_line(uuid,uuid,uuid,uuid,numeric)'::regprocedure) like '%current_reconciled_expected_quantity%',
  'line saves capture reconciled expected quantity under the stock-row lock'
);
select ok(
  pg_get_functiondef('private.import_inventory_count_lines(uuid,uuid,jsonb)'::regprocedure) like '%private.save_inventory_count_line%'
  and pg_get_functiondef('private.import_inventory_count_lines(uuid,uuid,jsonb)'::regprocedure) not like '%inventory_levels%update%',
  'CSV line entry delegates to manual validation and remains stock-neutral'
);
select ok(
  pg_get_functiondef('private.create_inventory_count_batch(uuid,text,text,uuid[],text,text,boolean)'::regprocedure) like '%private.create_inventory_count_plan%'
  and pg_get_functiondef('private.create_inventory_count_batch(uuid,text,text,uuid[],text,text,boolean)'::regprocedure) not like '%apply_inventory_change%',
  'multi-store batch creation coordinates independent stock-neutral documents'
);
select has_index('public', 'inventory_count_batch_documents', 'inventory_count_batch_documents_batch_store_unique', 'a batch owns at most one document per store');
select ok(
  exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'inventory_count_batch_documents' and qual like '%has_store_read_scope%'),
  'batch document reads retain assigned-store scope'
);

select * from finish();
rollback;
