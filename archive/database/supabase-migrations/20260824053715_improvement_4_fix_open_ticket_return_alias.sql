begin;

do $$
declare
  function_definition text;
  target_procedure regprocedure :=
    'private.save_open_ticket(uuid,uuid,uuid,uuid,uuid,uuid,text,text,jsonb)'::regprocedure;
begin
  select pg_get_functiondef(target_procedure) into function_definition;

  if position('insert into public.open_tickets (' in function_definition) = 0
    or position('returning id, created_at, updated_at;' in function_definition) = 0 then
    raise exception 'Unexpected save_open_ticket definition; aborting safe return alias correction.';
  end if;

  function_definition := replace(
    function_definition,
    'insert into public.open_tickets (',
    'insert into public.open_tickets as open_ticket ('
  );
  function_definition := replace(
    function_definition,
    'returning id, created_at, updated_at;',
    'returning open_ticket.id, open_ticket.created_at, open_ticket.updated_at;'
  );

  execute function_definition;
end;
$$;

notify pgrst, 'reload schema';

commit;
