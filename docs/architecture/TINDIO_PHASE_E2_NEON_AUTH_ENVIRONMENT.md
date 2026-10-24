# TINDIO Phase E2 isolated Neon Auth environment

Status: **E2 COMPLETE — ISOLATED ENVIRONMENT READY; APPLICATION PROOF NOT RUN**

Provisioned: 2026-10-24

E2 provisions a disposable Neon environment for synthetic authentication proof.
It does not integrate Web, Mobile, or Backend runtimes and does not change any
deployed origin, local environment file, or the repository's linked Neon
context. Supabase Auth remains the active application identity provider.

## Isolation outcome

- The legacy recovery project rejected schema-only branching because its old
  `anonymous` web-access role is incompatible with that beta branch type.
- No branch was created in the recovery project and that project was not
  modified.
- Owner approval authorized the safe fallback: a dedicated empty Neon project
  in `aws-us-east-2`, with all proof work confined to a non-default child branch.
- Child branch `phase-e2-auth-proof` (`br-spring-shape-b5qliuku`) expires at
  `2026-10-31T04:30:00Z`.
- Neon does not permit expiry on a project's default branch. The empty default
  branch therefore remains until the temporary project is manually deleted
  after Phase E. It is not an application target.

## Provisioned services

- Managed Better Auth is enabled only on the expiring child branch.
- Redirects are limited to localhost for the current proof stage.
- Neon Data API is active with `neon_auth` verification because the certified
  canonical installer requires provider-owned `auth.user_id()` and `auth.jwt()`
  helpers before it writes business schema.
- Its schema cache was refreshed after canonical installation and read-only
  status verification reported `active` at `2026-10-24T04:58:51Z`.
- No default Data API table grants were requested. The canonical role adapter
  retains the explicit TINDIO role mappings and RLS boundary.

## Canonical schema and data boundary

The manifest-backed canonical installer passed its local 5/5 gate, verified the
exact direct Neon host/database and empty target, then installed the certified
baseline plus all 18 ordered migrations and the Neon role/identity adapters.

Independent live assertions found:

- 101 public tables, 10 private tables, 214 public functions, and 149 policies;
- zero unvalidated foreign keys;
- 65 canonical permission reference rows and three provider role mappings;
- `auth.user_id()`, `auth.jwt()`, and the private identity adapter present;
- the latest `pos_operational_alerts` migration present;
- zero organization rows and zero profile rows.

## Synthetic identity policy

Exactly one branch-local Auth identity exists:
`phase-e2-owner@auth-proof.tindio.invalid`. The `.invalid` domain is
non-routable. No password, real email, Supabase user, merchant profile, session,
or organization was imported. Account signup, password setup/reset, email
verification, and application login remain runtime proof work, not E2 evidence.

## Cleanup and rollback

- Branch deletion or automatic expiry removes the E2 schema, Auth identities,
  sessions, configuration, and Data API endpoint without touching application
  environments.
- The Neon organization administrator can delete the temporary project after
  Phase E; manual project deletion is required because the empty default branch
  cannot expire.
- Supabase Auth and the current external-JWT canonical Neon environment remain
  unchanged and are the rollback authority throughout the proof.

Machine-readable evidence is in
`TINDIO_PHASE_E2_NEON_AUTH_ENVIRONMENT.json`. The 13-flow Auth proof matrix is
unchanged: every flow remains `NOT_RUN`.

## Next slice

E3 introduces provider-neutral Auth contracts/adapters behind explicit runtime
selection. It must not point deployed clients at this environment or claim any
of the 13 runtime flows as passing.
