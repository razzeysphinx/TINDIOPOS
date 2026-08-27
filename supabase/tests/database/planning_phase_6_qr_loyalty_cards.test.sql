begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

select has_table('public', 'loyalty_cards', 'QR loyalty cards table exists');
select has_table('public', 'loyalty_card_events', 'QR loyalty-card event ledger exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.loyalty_cards'::regclass),
  'QR loyalty cards have RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.loyalty_card_events'::regclass),
  'QR loyalty-card events have RLS enabled'
);
select ok(
  has_function_privilege('anon', 'public.verify_loyalty_card_qr(uuid,text)', 'execute'),
  'anonymous visitors can use the narrow QR verifier'
);
select ok(
  not has_table_privilege('anon', 'public.loyalty_cards', 'select'),
  'anonymous visitors cannot read loyalty-card records directly'
);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('66666666-6666-4666-8666-666666666661', 'qr-loyalty-owner@tindio.test', '{"full_name":"QR Loyalty Owner"}'::jsonb),
  ('66666666-6666-4666-8666-666666666662', 'qr-loyalty-outsider@tindio.test', '{"full_name":"QR Loyalty Outsider"}'::jsonb);

create temporary table phase6_loyalty_context (
  organization_id uuid not null,
  customer_id uuid,
  store_id uuid not null
);
create temporary table phase6_loyalty_cards (
  label text primary key,
  card_id uuid not null,
  verification_token text not null
);
grant select, insert, update on table phase6_loyalty_context, phase6_loyalty_cards to authenticated, anon;

set local role authenticated;
set local request.jwt.claim.sub = '66666666-6666-4666-8666-666666666661';

insert into phase6_loyalty_context (organization_id, store_id)
select organization_id, store_id
from public.bootstrap_organization(
  'QR Loyalty Retail',
  'QR Loyalty Main',
  'QR Loyalty Counter'
);

with inserted_customer as (
  insert into public.customers (organization_id, full_name, email)
  select organization_id, 'QR Loyalty Customer', 'qr-loyalty-customer@tindio.test'
  from phase6_loyalty_context
  returning id
)
update phase6_loyalty_context
set customer_id = (select id from inserted_customer);

insert into phase6_loyalty_cards (label, card_id, verification_token)
select 'primary', card_id, repeat('a', 64)
from public.issue_loyalty_card(
  (select organization_id from phase6_loyalty_context),
  (select customer_id from phase6_loyalty_context),
  'TND-LY-TEST000001',
  repeat('a', 64),
  null,
  null
);

select is(
  (select status from public.get_customer_loyalty_cards(
    (select organization_id from phase6_loyalty_context),
    (select customer_id from phase6_loyalty_context)
  ) limit 1),
  'active',
  'an authorized employee can issue an active QR loyalty card'
);

reset role;
set local role anon;

select is(
  (select verification_status from public.verify_loyalty_card_qr(
    (select card_id from phase6_loyalty_cards where label = 'primary'),
    (select verification_token from phase6_loyalty_cards where label = 'primary')
  )),
  'valid',
  'the public QR verifier resolves the server-side active card state'
);
select is(
  (select verification_status from public.verify_loyalty_card_qr(
    (select card_id from phase6_loyalty_cards where label = 'primary'),
    repeat('f', 64)
  )),
  'invalid',
  'a QR verifier rejects an incorrect opaque token'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '66666666-6666-4666-8666-666666666661';

select * from public.rotate_loyalty_card_qr(
  (select organization_id from phase6_loyalty_context),
  (select card_id from phase6_loyalty_cards where label = 'primary'),
  repeat('b', 64),
  'Lost printed card'
);

update phase6_loyalty_cards
set verification_token = repeat('b', 64)
where label = 'primary';

reset role;
set local role anon;

select is(
  (select verification_status from public.verify_loyalty_card_qr(
    (select card_id from phase6_loyalty_cards where label = 'primary'),
    repeat('a', 64)
  )),
  'invalid',
  'a rotated QR token invalidates the earlier printed QR code'
);
select is(
  (select verification_status from public.verify_loyalty_card_qr(
    (select card_id from phase6_loyalty_cards where label = 'primary'),
    (select verification_token from phase6_loyalty_cards where label = 'primary')
  )),
  'valid',
  'a rotated QR token verifies successfully'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '66666666-6666-4666-8666-666666666661';

select is(
  (select stamp_count from public.add_loyalty_card_stamp(
    (select organization_id from phase6_loyalty_context),
    (select card_id from phase6_loyalty_cards where label = 'primary'),
    'Manual quality-assurance stamp',
    null,
    gen_random_uuid()
  )),
  1,
  'a controlled staff action records the first loyalty stamp'
);
select throws_ok(
  format(
    $$select * from public.claim_loyalty_card_reward(%L::uuid, %L::uuid, 'Too early', null, gen_random_uuid())$$,
    (select organization_id from phase6_loyalty_context),
    (select card_id from phase6_loyalty_cards where label = 'primary')
  ),
  '23514',
  'This loyalty card has not reached its reward target.',
  'a reward cannot be claimed before the stamp target is reached'
);

do $$
declare
  action_index integer;
begin
  for action_index in 1..9 loop
    perform public.add_loyalty_card_stamp(
      (select organization_id from phase6_loyalty_context),
      (select card_id from phase6_loyalty_cards where label = 'primary'),
      'Manual quality-assurance stamp',
      null,
      gen_random_uuid()
    );
  end loop;
end;
$$;

select is(
  (select stamp_count from public.get_customer_loyalty_cards(
    (select organization_id from phase6_loyalty_context),
    (select customer_id from phase6_loyalty_context)
  ) where card_id = (select card_id from phase6_loyalty_cards where label = 'primary')),
  10,
  'the card becomes reward-ready only after its complete stamp target'
);

select * from public.claim_loyalty_card_reward(
  (select organization_id from phase6_loyalty_context),
  (select card_id from phase6_loyalty_cards where label = 'primary'),
  'Reward issued during quality assurance',
  null,
  gen_random_uuid()
);

reset role;
set local role anon;

select is(
  (select verification_status from public.verify_loyalty_card_qr(
    (select card_id from phase6_loyalty_cards where label = 'primary'),
    (select verification_token from phase6_loyalty_cards where label = 'primary')
  )),
  'reward_claimed',
  'a claimed reward is visible as a current server-side verifier state'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '66666666-6666-4666-8666-666666666661';

insert into phase6_loyalty_cards (label, card_id, verification_token)
select 'replacement', card_id, repeat('c', 64)
from public.issue_loyalty_card(
  (select organization_id from phase6_loyalty_context),
  (select customer_id from phase6_loyalty_context),
  'TND-LY-TEST000002',
  repeat('c', 64),
  (select card_id from phase6_loyalty_cards where label = 'primary'),
  'Starting a replacement stamp card'
);

reset role;
set local role anon;

select is(
  (select verification_status from public.verify_loyalty_card_qr(
    (select card_id from phase6_loyalty_cards where label = 'primary'),
    (select verification_token from phase6_loyalty_cards where label = 'primary')
  )),
  'replaced',
  'a replaced loyalty card reports its current replacement state'
);
select is(
  (select verification_status from public.verify_loyalty_card_qr(
    (select card_id from phase6_loyalty_cards where label = 'replacement'),
    (select verification_token from phase6_loyalty_cards where label = 'replacement')
  )),
  'valid',
  'the replacement QR loyalty card verifies as active'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '66666666-6666-4666-8666-666666666661';

select public.revoke_loyalty_card(
  (select organization_id from phase6_loyalty_context),
  (select card_id from phase6_loyalty_cards where label = 'replacement'),
  'Card surrendered during quality assurance'
);

reset role;
set local role anon;

select is(
  (select verification_status from public.verify_loyalty_card_qr(
    (select card_id from phase6_loyalty_cards where label = 'replacement'),
    (select verification_token from phase6_loyalty_cards where label = 'replacement')
  )),
  'revoked',
  'a revoked loyalty card cannot verify as active'
);

reset role;
update public.loyalty_cards
set expires_at = now() - interval '1 minute'
where id = (select card_id from phase6_loyalty_cards where label = 'replacement');

set local role anon;

select is(
  (select verification_status from public.verify_loyalty_card_qr(
    (select card_id from phase6_loyalty_cards where label = 'replacement'),
    (select verification_token from phase6_loyalty_cards where label = 'replacement')
  )),
  'expired',
  'an expired QR card reports expiry from the current server-side state'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '66666666-6666-4666-8666-666666666662';

select throws_ok(
  format(
    $$select * from public.issue_loyalty_card(%L::uuid, %L::uuid, 'TND-LY-TEST000003', repeat('d', 64), null, null)$$,
    (select organization_id from phase6_loyalty_context),
    (select customer_id from phase6_loyalty_context)
  ),
  '42501',
  'Customer management permission is required.',
  'a user outside the organization cannot issue a QR loyalty card'
);

select * from finish();
rollback;
