# Organization archive/deactivation local certification

Captured: 2026-10-05  
Base: `040cd43feaafc80763208f4b000b677040fd0f3d`  
Branch: `post-r9/certification-tenant-archive-design`

## Result

PASS. This packet reused the pre-existing generic organization lifecycle; it
did not add a migration or change database schema. The implementation closes
the application selection gap by admitting only active organizations to the
operational selector and by rechecking lifecycle state before the server action
writes its HttpOnly organization-selection cookie.

## Local database classification

The canonical installer was executed only against the local Docker Supabase
target at `127.0.0.1`. The installer normalized Windows CRLF checkout text to
the manifest-pinned LF canonical representation before hashing or installing;
the source baseline was not rewritten. The locked baseline SHA was
`b3a0fd6bac3f670b251680698c315e229eff940e05fc1370f5f392b198d50a87`.
All canonical migrations through `0012_provider_neutral_realtime_dispatch.sql`
applied. No `0013` migration is required because the lifecycle already exists.

## Gates

| Gate | Result |
| --- | --- |
| Canonical fresh local install | PASS |
| Canonical install/archive contract | PASS (5 checks) |
| Local pgTAP, database lint, concurrency, build and 20-browser suite | PASS |
| Archive selection static regression | PASS (2 checks) |
| Provider-neutral organization-governance audit | PASS |
| TypeScript | PASS |
| Mobile TypeScript | PASS |
| ESLint | PASS with 2 pre-existing warnings and 0 errors |
| Static automated catalogue | PASS (130 automated commands; 2 manual auth-dependent commands intentionally deferred) |
| R9 historical archive integrity on design branch | PASS |
| R4 handover SHA / diff | PASS; `F72F6BFABEFD6E3D579C999B24D21B22307D5C89D6621F973516F56A3F22B141`; no diff |

The pre-existing `test:tenant-load` manual integration command was not a
negative product result: it requires `TINDIO_TEST_COOKIE` from a signed-in
local browser request and remains intentionally deferred by the certification
catalogue. No archival operation, test fixture, or application call targeted
production Neon.

## Invariants

- `private.assert_organization_operational()` and all current guards are
  unchanged; archived writes remain denied at the database boundary.
- `private.guard_inventory_count_line_lifecycle()` and both inventory-count
  lifecycle triggers are unchanged; no trigger disablement, replica session,
  bypass privilege, or history rewrite was used.
- The local archive suite retained history and passed the existing lifecycle
  export/recovery coverage. The 20-browser suite included cross-tenant
  isolation coverage.
- No Supabase Auth user, provider identity key, Data API grant, RAZZEY row, or
  production business record was changed.

## Production declaration

NONE â€” no production archive/deactivation or business-data mutation was
executed. No remote push, pull request, merge, branch deletion, or resource
deletion was performed.

