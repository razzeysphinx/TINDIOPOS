-- The function is used by the open-tickets RLS policy. PostgreSQL evaluates
-- function privileges before the policy expression, so authenticated POS users
-- need this narrow grant to read only the tickets on their active drawer.
grant execute on function private.has_active_pos_shift_access(uuid, uuid, uuid)
to authenticated;
