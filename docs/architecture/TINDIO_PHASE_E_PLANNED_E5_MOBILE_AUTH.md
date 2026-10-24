# Phase E planned slice E5: Mobile Auth and custody proof

Status: **PASS — MOBILE FLOWS 3/3; PHASE E 11/13 PASS**

Completed: 2026-10-24

This is the fifth slice in the original six-slice Phase E plan. Earlier,
smaller implementation commits used internal E4–E6 gate labels; those labels
do not expand the approved plan. This slice completes the planned Mobile Auth
integration and custody proof.

The Expo runtime now has a provider-neutral Neon implementation for password
sign-in, session recovery, JWT retrieval, bounded refresh, auth-state events,
and sign-out. It is enabled only when all of these conditions hold:

- the selected provider is `neon`;
- proof mode is explicitly `local`;
- the build is not an EAS production build;
- the Auth endpoint is a managed HTTPS `neonauth...neon.tech/.../auth` URL; and
- the request origin is an explicit localhost HTTP origin.

Otherwise provider selection fails closed or retains the Supabase default.
No checked-in environment or deployment was changed.

The adapter persists only Neon's session cookie under the dedicated
`tindio.auth.neon.session-cookie.v1` SecureStore key. It obtains the short-lived
bearer JWT from the authenticated `/token` endpoint and coalesces concurrent
refresh calls into one `/get-session` plus one `/token` exchange. The existing
POS request boundary still performs at most one refresh and one request retry
after a 401.

The live disposable-branch proof directly established:

- `E-AUTH-08`: fresh password sign-in, JWT issue, SecureStore-compatible cookie
  persistence, and session restoration through a newly created adapter;
- `E-AUTH-09`: two concurrent refresh requests coalesced into one bounded
  provider exchange; and
- `E-AUTH-10`: sign-out removed only the Neon Auth cookie while device identity,
  offline grant, SQLite transaction custody, receipt snapshots, and outbox rows
  remained unchanged.

The proof used one reserved `.invalid` identity, signed out the session, deleted
that exact identity, and restored the disposable branch's original email/password
configuration. Supporting Mobile SQLite/outbox/custody regression suites remain
part of the closure gate.

Evidence is recorded in
`TINDIO_PHASE_E_PLANNED_E5_MOBILE_AUTH_PROOF.json`. The final original Phase E
slice is planned E6: adversarial Data API/RLS, revocation, Supabase rollback,
and 13-flow closure.
