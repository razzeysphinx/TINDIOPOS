begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (
  id,
  email,
  raw_user_meta_data
)
values (
  '44444444-4444-4444-8444-444444444444',
  'r3-identity-resolution@tindio.test',
  '{"full_name":"R3 Identity Resolution Probe"}'::jsonb
);

select ok(
  to_regprocedure('private.current_identity_subject()') is not null,
  'current_identity_subject exists'
);

select ok(
  to_regprocedure('private.current_profile_id()') is not null,
  'current_profile_id exists'
);

select is(
  has_function_privilege(
    'anon',
    'private.current_identity_subject()',
    'EXECUTE'
  ),
  false,
  'anon cannot directly execute current_identity_subject'
);

select is(
  has_function_privilege(
    'authenticated',
    'private.current_identity_subject()',
    'EXECUTE'
  ),
  false,
  'authenticated cannot directly execute current_identity_subject'
);

select is(
  has_function_privilege(
    'service_role',
    'private.current_identity_subject()',
    'EXECUTE'
  ),
  false,
  'service_role cannot directly execute current_identity_subject'
);

select is(
  has_function_privilege(
    'anon',
    'private.current_profile_id()',
    'EXECUTE'
  ),
  false,
  'anon cannot directly execute current_profile_id'
);

select is(
  has_function_privilege(
    'authenticated',
    'private.current_profile_id()',
    'EXECUTE'
  ),
  false,
  'authenticated cannot directly execute current_profile_id'
);

select is(
  has_function_privilege(
    'service_role',
    'private.current_profile_id()',
    'EXECUTE'
  ),
  false,
  'service_role cannot directly execute current_profile_id'
);

select is(
  private.current_identity_subject(),
  null::text,
  'unauthenticated session has no provider subject'
);

select is(
  private.current_profile_id(),
  null::uuid,
  'unauthenticated session has no TINDIO profile'
);

set local request.jwt.claim.sub =
  '44444444-4444-4444-8444-444444444444';

set local request.jwt.claims =
  '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated","email":"r3-identity-resolution@tindio.test"}';

select is(
  private.current_identity_subject(),
  '44444444-4444-4444-8444-444444444444'::text,
  'mapped authentication subject resolves exactly'
);

select is(
  private.current_profile_id(),
  '44444444-4444-4444-8444-444444444444'::uuid,
  'mapped authentication subject resolves to permanent TINDIO profile'
);

set local request.jwt.claim.sub =
  '55555555-5555-4555-8555-555555555555';

set local request.jwt.claims =
  '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

select is(
  private.current_identity_subject(),
  '55555555-5555-4555-8555-555555555555'::text,
  'unmapped provider subject remains visible to the identity adapter'
);

select is(
  private.current_profile_id(),
  null::uuid,
  'unmapped provider subject fails closed without becoming a TINDIO profile'
);

select * from finish();

rollback;
