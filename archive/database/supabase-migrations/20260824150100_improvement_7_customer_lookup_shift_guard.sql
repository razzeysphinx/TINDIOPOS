-- The CRM migration adds card-code lookup to this existing POS routine. Keep
-- the established open-shift guard intact for databases that applied the first
-- version before that safeguard was restored.

begin;

do $$
declare
  function_definition text;
  old_fragment text := $old$
  if normalized_query is not null and char_length(normalized_query) > 100 then
    raise exception 'Customer search is limited to 100 characters.' using errcode = '23514';
  end if;

  if (select auth.uid()) is null
$old$;
  new_fragment text := $new$
  if normalized_query is not null and char_length(normalized_query) > 100 then
    raise exception 'Customer search is limited to 100 characters.' using errcode = '23514';
  end if;

  perform private.require_pos_workspace_access(
    target_organization_id,
    target_store_id
  );

  if (select auth.uid()) is null
$new$;
begin
  select pg_get_functiondef('public.search_pos_customers(uuid,uuid,text,integer)'::regprocedure)
  into function_definition;

  if position('perform private.require_pos_workspace_access(' in function_definition) = 0 then
    if position(old_fragment in function_definition) = 0 then
      raise exception 'Unexpected search_pos_customers definition; aborting shift-guard repair.';
    end if;

    execute replace(function_definition, old_fragment, new_fragment);
  end if;
end;
$$;

commit;
