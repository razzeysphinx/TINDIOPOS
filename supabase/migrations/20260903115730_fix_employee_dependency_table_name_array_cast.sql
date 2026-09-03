-- Correct the catalog-name/text array comparison used by employee-management
-- detail and permanent-deletion safeguards. This retains the original
-- dependency discovery, permission boundary, and SECURITY DEFINER posture.

begin;

create or replace function private.employee_dependency_tables(target_employee_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  dependency record;
  dependency_exists boolean;
  dependencies text[] := '{}'::text[];
begin
  for dependency in
    select distinct child_namespace.nspname as schema_name,
           child_table.relname as table_name,
           child_column.attname as column_name
    from pg_catalog.pg_constraint constraint_record
    join pg_catalog.pg_class child_table on child_table.oid = constraint_record.conrelid
    join pg_catalog.pg_namespace child_namespace on child_namespace.oid = child_table.relnamespace
    join lateral unnest(constraint_record.conkey) with ordinality child_key(attnum, position) on true
    join lateral unnest(constraint_record.confkey) with ordinality parent_key(attnum, position)
      on parent_key.position = child_key.position
    join pg_catalog.pg_attribute child_column
      on child_column.attrelid = child_table.oid and child_column.attnum = child_key.attnum
    join pg_catalog.pg_attribute parent_column
      on parent_column.attrelid = constraint_record.confrelid and parent_column.attnum = parent_key.attnum
    where constraint_record.contype = 'f'
      and constraint_record.confrelid = 'public.employees'::regclass
      and parent_column.attname = 'id'
      and not (
        child_namespace.nspname = 'public'
        and child_table.relname in ('employee_roles', 'employee_stores', 'audit_logs')
      )
      and not (
        child_namespace.nspname = 'private'
        and child_table.relname = 'employee_pin_credentials'
      )
    order by child_namespace.nspname, child_table.relname, child_column.attname
  loop
    execute format(
      'select exists (select 1 from %I.%I where %I = $1)',
      dependency.schema_name, dependency.table_name, dependency.column_name
    ) using target_employee_id into dependency_exists;

    if dependency_exists and not dependencies @> ARRAY[dependency.table_name::text] then
      dependencies := array_append(dependencies, dependency.table_name::text);
    end if;
  end loop;

  -- Employee-administration events are retained as immutable snapshots and do
  -- not turn a never-used invitation into an undeletable employee. Operational
  -- audit history still blocks erasure.
  if exists (
    select 1 from public.audit_logs audit
    where (audit.actor_employee_id = target_employee_id or audit.subject_employee_id = target_employee_id)
      and audit.event_type not like 'EMPLOYEE\_%' escape '\'
  ) then
    dependencies := array_append(dependencies, 'audit_logs');
  end if;

  return dependencies;
end;
$$;

revoke execute on function private.employee_dependency_tables(uuid)
from public, anon, authenticated, service_role;

commit;
