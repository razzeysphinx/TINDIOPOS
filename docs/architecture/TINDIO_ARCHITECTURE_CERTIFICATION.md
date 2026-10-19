# TINDIO architecture certification

Status: **SLICE B2 DEVICE, DATA SYNC, AND CART VALUES CERTIFIED; ENVIRONMENT BLOCKER RECORDED**

Certified scope: Phase 0, Slice B1, and the Slice B2 device/data-sync/cart-value domains

Authentication: **SUPABASE_ACTIVE**
Database: **CANONICAL NEON UNCHANGED**

## Certified in this slice

- Git safety and canonical remote synchronization.
- Architecture audit, target, dependency map, migration ADR/sequence, and
  production cutover checklist.
- pnpm discovery for both `apps/*` and `packages/*`.
- Independent `@tindio/contracts` typecheck and platform-neutral boundary.
- Compatibility re-export of the existing POS v2 version identifier.
- Explicit Web, Mobile, contracts, and combined workspace commands.
- Unchanged Web route output and Android export.
- Provider-neutral device schemas, headers, bindings, and sequence/checkpoint
  metadata extracted into `@tindio/contracts`.
- Existing Web device and POS contract paths retained as compatibility facades.
- Device-only Mobile consumers switched from root-relative Web imports to the
  workspace package, reducing that coupling from 37 files to 34.
- Independent sync domain, baseline, cursor-expiry, and device-delta contracts
  extracted without moving checkout- or Web-DTO-dependent payloads.
- Matching Mobile sync consumers now use the workspace package, reducing
  root-relative Web contract imports from 34 files to 33.
- Catalogue, customer, payment/reference, and concrete delta-pull/resnapshot
  DTOs extracted with their existing serialized fields unchanged.
- Matching Mobile cache, local-first, cashier, and sync consumers now use the
  workspace package, reducing root-relative POS-contract imports from 33 to 23.
- Modifier option/group responses and cart-line values extracted without moving
  pricing functions, checkout schemas, checkout results, or transaction actions.
- Matching Mobile pricing, modifier-cache, cashier, inventory, and outbox
  consumers now use the package, reducing root-relative imports from 23 to 16.

## Results

| Gate | Result |
|---|---|
| Architecture foundation | **PASS (3/3)** |
| POS shared-contract compatibility | **PASS (7/7)** |
| POS v1 retirement compatibility | **PASS (5/5)** |
| Workspace typecheck | **PASS** (Web + contracts + Mobile) |
| Repository structure and Markdown links | **PASS (7/7)** |
| ESLint | **PASS WITH 2 PRE-EXISTING WARNINGS** |
| Next.js production build | **PASS (90 routes)** |
| Android export | **PASS** |
| Device contract compatibility | **PASS (3/3)** |
| Sync-control contract compatibility | **PASS (3/3)** |
| POS data-contract compatibility | **PASS (3/3)** |
| Cart/modifier contract compatibility | **PASS (3/3)** |
| Device sequence and delta reconciliation | **PASS (2/2)** |
| Catalogue/cache/local-first/resnapshot behavior | **PASS (11/11)** |
| Pricing/checkout-intent/outbox/offline-cart behavior | **PASS (39/39)** |
| Device retirement custody | **PASS (4/4)** |
| Sequence replay, delta resnapshot, and shift custody | **PASS (20/20)** |
| Static catalogue | **179/180 automated commands pass** |
| Local Supabase/Docker source connectivity | **BLOCKED** — local source unavailable |
| Full local DB/pgTAP | **NOT_RUN** due to the same environment blocker |
| Physical Android certification | **NOT_RUN**; prior evidence status preserved |

The failed environment gate existed before both architecture slices. Each B2
contract checkpoint added one passing automated command and introduced no new
failure.

## Safety statement

No production Auth service was provisioned. No database schema or merchant data
changed. No account was exported/imported. No session format, JSON wire field,
API route, checkout behavior, SQLite database, outbox record, deployment, or
provider project changed.

## Next gate

Continue Slice B2 with the next coherent platform-neutral read-model group,
recommended: store/register/shift and open-ticket DTOs that do not depend on
server actions. The root compatibility facade and exact serialized fields must
remain stable. Backend creation and Neon Auth proof remain later slices.
