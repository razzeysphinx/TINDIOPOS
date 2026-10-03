begin;

alter table public.permissions
  drop constraint if exists permissions_code_format;

alter table public.permissions
  add constraint permissions_code_format
  check (
    code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
  );

comment on constraint permissions_code_format
on public.permissions
is
  'Permission codes use lowercase dot-separated namespaces with at least two segments, for example inventory.manage or inventory.transfer.create.';

commit;
