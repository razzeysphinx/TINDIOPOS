begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select ok(
  to_regprocedure('public.restore_tindio_payment_preset(uuid,text,uuid[])') is not null,
  'payment preset restoration routine exists'
);
select ok(
  has_function_privilege('authenticated', 'public.restore_tindio_payment_preset(uuid,text,uuid[])', 'execute'),
  'authenticated settings managers can call payment preset restoration'
);
select ok(
  not has_function_privilege('anon', 'public.restore_tindio_payment_preset(uuid,text,uuid[])', 'execute'),
  'anonymous callers cannot restore payment presets'
);

insert into auth.users (id, email, raw_user_meta_data)
values ('28282828-2828-4828-8828-282828282828', 'phase-8-owner@tindio.test', '{"full_name":"Phase 8 Owner"}'::jsonb);

create temporary table phase_8_context (
  organization_id uuid not null,
  store_id uuid not null,
  gcash_id uuid,
  restored_gcash_id uuid
);
grant select, insert, update on phase_8_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '28282828-2828-4828-8828-282828282828';

insert into phase_8_context (organization_id, store_id)
select organization_id, store_id
from public.bootstrap_organization('Phase 8 Presets Retail', 'Phase 8 Main', 'Phase 8 Counter');

update phase_8_context
set gcash_id = method.id
from public.payment_methods method
where method.organization_id = phase_8_context.organization_id
  and method.code = 'GCASH';

select throws_ok(
  format(
    $$select public.create_store_scoped_payment_method(%L, 'Pretend GCash', 'GCASH', 'E_WALLET', false, array[%L::uuid])$$,
    (select organization_id from phase_8_context),
    (select store_id from phase_8_context)
  ),
  '23514',
  'TINDIO default payment methods are managed from the preset list.',
  'canonical preset codes cannot be created as custom methods'
);

select lives_ok(
  format(
    $$select public.update_payment_method_configuration(%L, %L, 'GCash', false, false, 30)$$,
    (select organization_id from phase_8_context),
    (select gcash_id from phase_8_context)
  ),
  'an unused payment preset can be disabled before removal'
);

select is(
  public.delete_unused_setup_record(
    (select organization_id from phase_8_context),
    'payment_method',
    (select gcash_id from phase_8_context),
    'GCash'
  ),
  'GCash',
  'an unused payment preset can be removed before restoration'
);

update phase_8_context
set restored_gcash_id = public.restore_tindio_payment_preset(
  organization_id,
  'GCASH',
  array[store_id]
);

select ok(
  (select restored_gcash_id is not null from phase_8_context),
  'settings manager can restore a missing TINDIO payment preset'
);
select ok(
  exists (
    select 1
    from public.payment_methods method
    join phase_8_context context
      on context.organization_id = method.organization_id
     and context.restored_gcash_id = method.id
    where method.name = 'GCash'
      and method.code = 'GCASH'
      and method.payment_type = 'E_WALLET'
      and not method.requires_reference
      and method.sort_order = 30
  ),
  'restored preset has its canonical name, type, and reporting order'
);
select ok(
  exists (
    select 1
    from public.store_payment_methods mapping
    join phase_8_context context
      on context.organization_id = mapping.organization_id
     and context.store_id = mapping.store_id
     and context.restored_gcash_id = mapping.payment_method_id
    where mapping.is_enabled
  ),
  'restored preset is enabled for the selected active store'
);
select is(
  public.restore_tindio_payment_preset(
    (select organization_id from phase_8_context),
    'GCASH',
    array[(select store_id from phase_8_context)]
  ),
  (select restored_gcash_id from phase_8_context),
  'restoring an existing preset is idempotent'
);
select is(
  (
    select count(*)
    from public.payment_methods method
    join phase_8_context context on context.organization_id = method.organization_id
    where method.code = 'GCASH'
  ),
  1::bigint,
  'idempotent restoration does not duplicate the payment method'
);
select throws_ok(
  format(
    $$select public.restore_tindio_payment_preset(%L, 'NOT_A_PRESET', array[%L::uuid])$$,
    (select organization_id from phase_8_context),
    (select store_id from phase_8_context)
  ),
  '23514',
  'Choose a valid TINDIO payment preset.',
  'only supported payment presets can be restored'
);

select * from finish();
rollback;
