-- Keep future organization bootstrap bundles aligned with the documented
-- Owner-only recovery-management exception. This updates the established
-- bootstrap provisioner; it does not affect customer-defined roles.
begin;

do $$
declare
  bootstrap_definition text;
  previous_admin_filter constant text :=
    'permission.code not in (''organization.manage'', ''organization.archive'', ''organization.lifecycle'')';
  aligned_admin_filter constant text :=
    'permission.code not in (''organization.manage'', ''organization.archive'', ''organization.lifecycle'', ''recovery.manage'')';
begin
  select pg_get_functiondef(
    'public.bootstrap_organization(text,text,text,text,text)'::regprocedure
  )
  into bootstrap_definition;

  if position(previous_admin_filter in bootstrap_definition) = 0 then
    raise exception 'Unexpected bootstrap_organization Admin permission filter; refusing RBAC preset change.';
  end if;

  bootstrap_definition := replace(
    bootstrap_definition,
    previous_admin_filter,
    aligned_admin_filter
  );

  execute bootstrap_definition;
end;
$$;

comment on function public.bootstrap_organization(text, text, text, text, text)
is 'Atomically creates an independent organization, starter roles, owner, store, and register. Preset roles are permission bundles; Owner receives all registered capabilities and Admin excludes organization lifecycle and recovery-management controls by default.';

commit;
