# Phase J directory ownership

The canonical top-level ownership is:

| Directory | Ownership |
| --- | --- |
| `apps/` | independently buildable Backend and Mobile applications |
| `src/` | root Next.js Web application |
| `packages/` | platform-neutral shared packages and contracts |
| `database/` | canonical provider-neutral database source |
| `supabase/` | active Supabase CLI/migration compatibility surface |
| `scripts/` | certification, migration, audit, and operator tooling |
| `docs/` | current documentation and evidence |
| `archive/` | immutable historical source/evidence retained for audit |
| `tests/` | browser and cross-surface integration tests |
| `public/` | Web static assets |

Root configuration files stay at the root when their tools require that
location. In particular, `neon.ts` intentionally references `hello.ts`; moving
either without deployment proof would change infrastructure behavior.

Local build, test, package-store, audit, and device-harness outputs are ignored
and are not canonical source. Phase J does not delete local developer output or
rewrite historical evidence.
