# Source-control blocker supersession evidence

Date: 2026-10-07

## Scope

This record resolves the three branches that blocked the final source-control
consolidation. It is a documentation-only assessment made from canonical
`TINDIO-PREPRODUCTION` at `bce039476025da609ff30c06692e8547d4bea1e2`.
No historical implementation is merged merely to make commit ancestry clean.

The intended cleanup rule is that a stale branch pointer may be removed when
its unique commit is empty, or when its intent is demonstrably implemented by
the current architecture and certification surface. The assessment below uses
the current POS V2 and provider-neutral architecture as the authority.

## `diagnostic/phase-04-base-control`

- Tip: `9f22d5ae28c653c758121b2a6b6872e52d010595`
- Unique commit: `test(vercel): create fresh Phase 04 base control deployment`
- Compared with its Phase 04 base `5d04729a5d09a50408e15efadd9e22f6e01731ac`.

`git diff --stat` and `git diff --name-only` produced no repository-file
delta. `git show --stat --summary` also showed no file content. This is an
empty historical control-deployment commit.

Classification: **SAFE - EMPTY HISTORICAL CONTROL COMMIT**.

## `migration/phase-04-bootstrap-reliability`

- Tip: `170b972006d57a854eb3c93b58eb8afae486ddbd`
- Unique commit: `fix(pos): stabilize Phase 04 bootstrap reads`
- Historical implementation: the retired `/api/pos/v1/bootstrap` route,
  `loadPosWorkspace`, and its large fan-out of V1 data reads.

The historical change added a two-attempt read-only retry, request correlation
headers, staged V1 fan-out waves, staged error messages, and safe Neon failure
metadata. It also added a source assertion for that retired V1 stack.

The current canonical replacement is the POS V2 core contract:

- `src/app/api/pos/v2/bootstrap/route.ts` obtains an authorized
  `get_pos_bootstrap_core_v2` result, returns a client-safe V2 core response,
  classifies auth/authorization/backend outcomes, and emits
  `x-tindio-request-id` on every outcome.
- `src/lib/auth/pos-v2-context.ts` creates a token-bound V2 client, calls the
  one core RPC, and exposes only a bounded retry for the transient
  `IDENTITY_UNMAPPED` provisioning envelope; it does not retry arbitrary
  business/database failures.
- V2 separates core, reference, live, catalog, and modifier domains, replacing
  the V1 monolithic fan-out with independently degradable reads. The V2 browser
  transport refreshes a session once and does not log tokens, passwords,
  authorization values, or cookies.
- The V1 route, V1 contract, V1 workspace loader, and V1 deployed certifier are
  absent and are asserted retired by the current test suite.

The safe-error/correlation intent is therefore represented by typed V2 failure
classification, client-safe reasons, correlation IDs, and the no-secret-logs
assertions. No missing current-architecture invariant or current defect was
found; no V1 code or test was ported.

Classification: **SAFE - INTENTIONALLY SUPERSEDED BY PHASE-04 V2**.

## `migration/phase-04-vercel-auth-stability`

- Tip: `06257c4281498b22df741a33fbce690006dbd71b`
- Unique commits:
  - `743b9a00286de357a737c954381999c8f3d32d48`
    `fix(auth): stabilize token-bound Neon requests on Vercel`
  - `06257c4281498b22df741a33fbce690006dbd71b`
    `test(auth): update provider-neutral identity transport contract`
- Historical implementation: the retired V1 POS context plus an earlier
  authenticated database client and a 100-request V1 deployed stability probe.

The historical intent was verified bearer/session handling, database identity
propagation without relying on SSR cookies, separation of provider subject from
stable profile identity, safe cookie fallback, and provider-neutral Neon/Vercel
request handling.

The current canonical replacement is the V2/provider-neutral boundary:

- `src/lib/auth/pos-v2-context.ts` accepts only a syntactically valid bearer
  token for V2, rejects invalid/missing values, performs token verification,
  resolves the current profile through the provider-neutral identity boundary,
  and binds the token to the V2 database client.
- `src/lib/supabase/pos-v2-database-client.ts` uses a stateless explicit-token
  client and routes Neon requests through the canonical provider adapter.
- `src/lib/auth/dal.ts` and `src/lib/supabase/context-client.ts` retain the
  server-side cookie transport only as verified authorization metadata and
  preserve its `Authorization` header for both cookie and bearer contexts.
- `fix/neon-pos-workspace-auth-boundary` at
  `2d48e2ead33d783aef6c61dedb661ba74714ea9a` is already an ancestor of this
  canonical commit. Its current certification protects the POS workspace with
  `private.current_profile_id()`, scope checks, permission checks, and no
  direct provider `auth.uid()` dependency.
- The retired `src/lib/auth/pos-api-context.ts` and old
  `authenticated-database-client.ts` are absent. The retained
  `context-client.ts` is the current verified transport adapter, not the old
  V1 POS context.

No missing current-architecture invariant or current defect was found; no
stale auth implementation or historical test was ported.

Classification: **SAFE - INTENTIONALLY SUPERSEDED BY CURRENT PROVIDER-NEUTRAL / NEON AUTH BOUNDARY**.

## Certification used for the assessment

All passed at the canonical starting commit:

- `pnpm run test:phase-04-pos-v2-core` - 5 passing tests.
- `pnpm run test:phase-04-v2-final-architecture` - 7 passing tests.
- `pnpm run test:phase-04-v1-retirement` - 5 passing tests.
- `pnpm run test:phase-04-cookie-neon-auth` - 4 passing tests.
- `pnpm run test:phase-02-mobile-auth-contract` - 9 passing tests.
- `pnpm run test:neon-pos-workspace-auth-repair` - 3 passing tests.
- `node scripts/provider-neutral-application-auth-check.mjs` - 12 passing
  tests.
- `pnpm run typecheck` - passed.
- `pnpm run lint` - passed with 3 pre-existing warnings and no errors.
- `pnpm run build` - passed.
- `pnpm run certify` - passed: 131 automated static package checks, canonical
  local database installation and certification, and all 20 Phase 14 Playwright
  browser checks. Manual hosted integration checks remained explicitly deferred
  by the certification catalogue.

## Resolution

These stale commits were **not** merged because doing so would reintroduce
retired V1/bootstrap or superseded auth architecture. No current product
behavior is intentionally removed by deleting their branch pointers. No
production, database, Auth, Neon, Supabase, Vercel-configuration, or runtime
change is included in this evidence record.
