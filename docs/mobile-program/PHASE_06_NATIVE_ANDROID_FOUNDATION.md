# Phase 06 — Native Android Foundation

SOURCE_OF_TRUTH: `docs/TINDIO_MOBILE_NEON_SOURCE_OF_TRUTH.md`

STATUS: `IMPLEMENTING`

SLICE: `06A — Native Workspace + Authenticated Backend V1 Handshake`

- Backend V1 base: `99c452536ec0344f8a1a7216a693799b6620573b`
- Native workspace: `apps/mobile`
- Auth: Supabase Auth
- Mobile transport: Bearer access token
- Backend: POS V2
- Business context: server-authoritative
- Direct database access from mobile: NONE
- SQLite: NOT STARTED — PHASE 07
- Device enrollment: NEXT 06B
- Store/register selection: NEXT 06B
- Shift/POS shells: later Phase 06 slices

## 06A

Status: `COMPLETE`

## 06B — Device Enrollment + Store/Register Binding

Native enrollment requires `devices.manage`. The device secret is retained in Expo SecureStore and is sent only to the authorized Backend V1 enrollment or validation API; the server stores only its existing secret hash. Store/register binding remains server-authoritative.

The provider-neutral device identity compatibility migration replaces provider-specific identity resolution with existing helpers. Tables/columns changed: NO. RBAC changed: NO. RLS changed: NO. Business semantics changed: NO.

## 06C — Native Shift/POS Shells

Status: `COMPLETE`

PHASE 06 IMPLEMENTATION: `COMPLETE`

PHASE 06 CERTIFICATION: `PENDING FINAL PHASE GATE`

- SQLite: NOT STARTED — PHASE 07
- Cold-start Offline: NOT STARTED — PHASE 08
- Local-first Cache: NOT STARTED — PHASE 09
- Durable Outbox: NOT STARTED — PHASE 10
- Delta Sync: NOT STARTED — PHASE 12
