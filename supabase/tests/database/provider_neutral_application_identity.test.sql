begin;

create extension if not exists pgtap with schema extensions;

set local search_path = public, extensions;

select plan(7);

-- These users exist only inside this transaction. The real auth-user
-- synchronization trigger provisions their profiles and identity links.
insert into auth.users (
  id,
  email,
  raw_user_meta_data
)
values
  (
    '91000000-0000-4000-8000-000000000001',
    'identity-subject@tindio.test',
    '{"full_name":"Identity Subject"}'::jsonb
  ),
  (
    '91000000-0000-4000-8000-000000000002',
    'stable-profile@tindio.test',
    '{"full_name":"Stable Profile"}'::jsonb
  );

select is(
  (
    select identity_link.profile_id::text
    from private.identity_links identity_link
    where identity_link.provider = 'supabase'
      and identity_link.provider_subject =
        '91000000-0000-4000-8000-000000000001'
  ),
  '91000000-0000-4000-8000-000000000001',
  'auth-user provisioning creates the subject identity mapping'
);

select is(
  (
    select identity_link.profile_id::text
    from private.identity_links identity_link
    where identity_link.provider = 'supabase'
      and identity_link.provider_subject =
        '91000000-0000-4000-8000-000000000002'
  ),
  '91000000-0000-4000-8000-000000000002',
  'auth-user provisioning creates the stable-profile identity mapping'
);

-- Prove that provider identity and TINDIO profile identity can differ. This
-- test-only mutation is rolled back at the end of the transaction.
delete from private.identity_links
where provider = 'supabase'
  and provider_subject in (
    '91000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000002'
  );

insert into private.identity_links (
  provider,
  provider_subject,
  profile_id
)
values (
  'supabase',
  '91000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000002'::uuid
);

set local role authenticated;
set local request.jwt.claim.sub =
  '91000000-0000-4000-8000-000000000001';

select is(
  public.current_profile_id()::text,
  '91000000-0000-4000-8000-000000000002',
  'provider subject resolves to a distinct stable TINDIO profile UUID'
);

reset role;

delete from private.identity_links
where provider = 'supabase'
  and provider_subject =
    '91000000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claim.sub =
  '91000000-0000-4000-8000-000000000001';

select ok(
  public.current_profile_id() is null,
  'unmapped provider subject fails closed'
);

reset role;

select ok(
  to_regprocedure('public.current_profile_id()') is not null,
  'public current-profile identity RPC exists'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.current_profile_id()',
    'EXECUTE'
  ),
  'authenticated may execute the current-profile identity RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.current_profile_id()',
    'EXECUTE'
  ),
  'anonymous callers cannot execute the current-profile identity RPC'
);

select * from finish();

rollback;
