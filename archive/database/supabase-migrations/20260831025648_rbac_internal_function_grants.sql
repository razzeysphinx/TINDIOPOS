-- Trigger procedures run as their table owner; they are never public API.
-- Revoke inherited direct execution from every client-facing database role.
begin;

revoke all on function private.default_legacy_transfer_line_received_quantity(),
  private.grant_cashier_ticket_capability()
from public, anon, authenticated, service_role;

comment on function private.default_legacy_transfer_line_received_quantity()
is 'Internal stock-transfer trigger procedure. Direct client execution is forbidden.';

comment on function private.grant_cashier_ticket_capability()
is 'Internal preset-role trigger procedure. Direct client execution is forbidden.';

commit;
