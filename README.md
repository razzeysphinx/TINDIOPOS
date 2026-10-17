# TINDIO

TINDIO is a multi-store point-of-sale and business-management platform with a
Next.js Web Back Office/POS and a native Expo/React Native Android POS.

## Architecture

- `src/` — Next.js 16 App Router application, web POS, Back Office, API routes,
  authentication boundaries, and business services.
- `apps/mobile/` — Android-first Expo SDK 57 cashier application with local
  SQLite, durable transaction custody, offline cash sales, and synchronization.
- `apps/store-hub/` — retained Store Hub transport. It is deliberately deferred
  from the v1 release and is not a certified merchant feature.
- `database/` — canonical business schema. `database/baseline/` holds the immutable
  baseline, followed by ordered forward migrations and provider adapters.
- `supabase/` — Supabase Auth/local test infrastructure. It is not the canonical
  location for TINDIO business migrations.
- `archive/database/` — historical Supabase migration chain retained for audit
  and recovery integrity; never use it as the normal production install path.

Supabase provides authentication. Neon PostgreSQL database `tindio_r6_recovery`
is the authoritative business database. Historical `neondb` is reference-only.
Browser and mobile clients reach business data through authenticated application/API
boundaries; they do not replace server-side authorization or database rules.

## Mobile operating model

The native POS is local-first. Product/reference snapshots are stored in SQLite,
and accepted offline work is held in a durable outbox with stable device and
transaction identity until the server reconciles it. The supported v1 offline
payment scope is cash only on a prepared, authorized terminal. Card/electronic
payments, unsupported carts, and expired authorization fail closed. Store Hub,
external scanners, printers, cash drawers, customer displays, and payment
terminals remain deferred or unsupported unless their specific evidence gate is
completed.

## Local setup

Requirements: Node.js 22, pnpm 10, Docker Desktop for local database checks, and
Android tooling only when building or running the native app.

The commands below install the canonical schema into the prepared local database;
the Neon installer applies the same manifest-backed schema through its provider
adapter.

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env.local
pnpm exec supabase start
$env:TINDIO_DATABASE_INSTALL='YES'
pnpm db:install:local
pnpm dev
```

Set only client-safe Supabase URL/publishable-key values in public variables.
Never place service-role keys, database passwords, device secrets, signing
material, or release credentials in the repository or any `NEXT_PUBLIC_*` /
`EXPO_PUBLIC_*` secret position.

For mobile setup, builds, physical-device testing, and release inputs, see
[apps/mobile/README.md](apps/mobile/README.md).

## Quality and certification

```powershell
pnpm typecheck
pnpm mobile:typecheck
pnpm lint
pnpm build
pnpm certify:static
pnpm mobile:export:android
```

`pnpm certify` additionally requires the prepared local database/Docker runtime.
Passing repository checks does not upgrade deferred physical Android, hardware,
accessibility, signing, Google Play, or real-store evidence.

## Documentation entry points

- [Repository documentation index](docs/README.md)
- [Repository structure](docs/repository/REPOSITORY_STRUCTURE.md)
- [Canonical mobile/Neon source of truth](docs/TINDIO_MOBILE_NEON_SOURCE_OF_TRUTH.md)
- [Canonical recovery source of truth](docs/recovery/TINDIO_NEON_RECOVERY_SOURCE_OF_TRUTH.md)
- [Mobile program index](docs/mobile-program/README.md)
- [Database architecture](docs/architecture.md)
- [Recovery and governance](docs/backup-recovery-and-data-governance.md)

Release status is intentionally fail-closed: `apps/mobile/production-release.json`
remains the machine-readable production gate. Do not infer production approval
from a successful development build or static test run.
