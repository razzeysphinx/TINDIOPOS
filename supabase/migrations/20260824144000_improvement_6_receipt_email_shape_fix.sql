-- Tighten the mailbox-shape helper with a correct single-@ check.

begin;

create or replace function private.valid_receipt_email(target_email text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select target_email is not null
    and char_length(target_email) between 3 and 320
    and position('@' in target_email) > 1
    and char_length(replace(target_email, '@', '')) = char_length(target_email) - 1
    and position('.' in split_part(target_email, '@', 2)) > 1
    and target_email !~ '[[:space:]]'
$$;

revoke execute on function private.valid_receipt_email(text) from public, anon, authenticated, service_role;

commit;
