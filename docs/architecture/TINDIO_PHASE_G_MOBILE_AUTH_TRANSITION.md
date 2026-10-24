# Phase G Mobile Auth transition foundation

Status: **G1 WEB ACTIVATION BLOCKED; G2 MOBILE FOUNDATION IMPLEMENTED**

## Decision

Phase G does not enable production Neon Auth. Web activation is blocked until
F1 reconciles every Supabase Auth-directory user to one stable TINDIO profile.
Activating the current Web sign-in path earlier could provision or attach the
wrong canonical profile, so the default remains Supabase.

The safe independent work is the in-place Mobile transition foundation. It:

- pins the Supabase SecureStore key to the exact key already derived by the
  client, so an installed-app upgrade continues reading its current session;
- detects a legacy Supabase session and a Neon session independently;
- reports `NEON_REAUTHENTICATION_REQUIRED` when Neon is selected but only the
  legacy session exists, without deleting that session;
- records the selected provider only after the Backend core call verifies the
  signed-in identity and tenant;
- keeps sign-out behind the existing transaction-custody release check; and
- provides a retirement predicate that requires verified identity, releasable
  custody, explicit owner approval, and an active Neon session.

No code in this slice clears SecureStore, resets SQLite, removes enrollment,
deletes receipts or outbox rows, changes sequence checkpoints, or retires the
legacy Auth session. The predicate authorizes no deletion by itself.

## Remaining physical proof

The cutover checklist stays open. A later Phase G slice must install an upgrade
over a representative existing app data set and prove preservation of device
enrollment, SQLite transactions, receipt snapshots, offline grants, pending
outbox operations, operation IDs, and sequence checkpoints. Fresh-install and
old-client compatibility must also be certified before any live cutover.
