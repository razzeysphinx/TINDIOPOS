-- The public Phase 8 wrapper is SECURITY INVOKER, so authenticated callers
-- also require execution on the protected implementation it delegates to.

begin;

grant usage on schema private to authenticated;
grant execute on function private.checkout_advanced_sale(
  uuid, uuid, uuid, uuid, jsonb, jsonb, uuid, integer, uuid, uuid, uuid, uuid
) to authenticated;

comment on function private.checkout_advanced_sale(
  uuid, uuid, uuid, uuid, jsonb, jsonb, uuid, integer, uuid, uuid, uuid, uuid
)
is 'Phase 8 protected checkout implementation. Authenticated execution is required by its validated SECURITY INVOKER wrapper.';

commit;
