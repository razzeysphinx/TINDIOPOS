# TINDIO Repository Structure

## Root

The root contains workspace configuration, the Next.js application toolchain,
Neon preview discovery (`neon.ts` and `hello.ts`), agent instructions, and the
canonical package command catalogue. Root infrastructure filenames remain
stable when external tooling discovers them by convention.

## Application code

- `src/` — Next.js web application, API routes, shared contracts, and domain-
  oriented web/business features. Existing feature boundaries are intentional.
- `apps/mobile/` — Expo/React Native Android POS. Route files coexist under the
  authenticated `(app)` group; support routes are permission-gated in the
  layout/navigation rather than moved solely for aesthetics.
- `apps/store-hub/` — deferred Store Hub transport retained for post-v1 work.
- `packages/contracts/` — platform-neutral versioned contract package. Its
  initial API-version export is consumed through the existing Web compatibility
  facade while larger POS contracts are separated incrementally.

## Data and provider infrastructure

- `database/baseline/` — immutable canonical baseline and manifest.
- `database/migrations/` — ordered forward migrations; never renumber, merge, or
  rewrite historical meaning.
- `database/provider/local/` and `database/provider/neon/` — provider adapters.
- `supabase/` — Auth/local-runtime configuration and database tests. The absence
  of `supabase/migrations/` is intentional.
- `archive/database/` — protected historical Supabase migration chain and
  manifest; not a production installation path.

## Documentation

- `docs/README.md` — canonical documentation index.
- `docs/mobile-program/` — mobile phases, MOB slices, release/operations reports,
  and distinct runtime evidence.
- `docs/recovery/` — protected recovery contracts, runbooks, and evidence.
- `docs/archive/plans/` — implemented historical product specifications.
- `docs/repository/` — structure, cleanup audit, deprecations, and inventory.

Stable source-of-truth and evidence paths are retained when movement would break
historical links or certification tooling.

## Tooling and tests

- `scripts/` — deterministic checks, certification runners, operational tools,
  database installers, helpers, and recovery tooling. See `scripts/README.md`.
- `tests/` — browser/end-to-end specifications and fixtures.
- `.github/workflows/` — authoritative branch certification workflow.
- `public/` — active web static assets, including the registered service worker.

## Agent/tooling policy

`AGENTS.md`, `CLAUDE.md`, `.agents/`, and `skills-lock.json` are development
workflow inputs and remain tracked. `.agents/` contains locked/vendored Neon
skills. Root `.vscode/` is local; the explicitly allowlisted mobile workspace
recommendations are safe shared team configuration.

## Licensing

License files are never deleted or relocated by hygiene work. The Expo license
in `apps/mobile/LICENSE` is recorded as `LICENSE_REVIEW_REQUIRED` because the
repository-wide ownership/licensing intent requires an owner decision.
