# MOB-10 Slice 6 — A28 delta process-death campaign

Status: **A28 PASS; MOB-10 REMAINS OPEN**

Starting commit: `ce322bc95764ede88543a2ce68decb35251d8979`

This slice proves on a physical Android device that catalog delta update and deletion pages remain atomic across process death, cursor advancement cannot skip an undelivered page, replay converges, and foreign-organization data is rejected before local mutation. A48 remains `NOT_RUN` because this is not the Phase 23/24 production-signed release candidate.

## Observed runtime defects and repair

The first physical pull reproduced HTTP 503 against the real catalog delta path. Three compatible defects were found:

- the historical single-product delta function asked `search_pos_catalog` for 10,000 rows after that canonical search function had been hardened to a maximum page size of 48;
- the function read the legacy `x-tindio-pos-device-id` header instead of the canonical `x-tindio-device-id` header;
- the Neon Data API returns JSONB scalar RPC results as objects, while the pull route assumed every result was a one-row array.

The architecture decision is **KEEP + HARDEN**. Migration `0015_mobile_delta_catalog_page_limit.sql` replaces only the existing single-product delta helper, retains canonical `search_pos_catalog`, enforces device/store access, and walks bounded 48-row pages. The POS v2 pull route now normalizes array-or-object JSONB RPC results. No second catalog engine, API version, or local database was introduced.

## Physical acceptance evidence

The synthetic product was `d9a4ebe5-bfb8-46a6-8e83-013fe1be2ed1` in Certification Store. It was updated through Back Office to `MOB-10 A28 Delta Fixture v2`, PHP 2.00, SKU `MOB10-A28-002`, and barcode `202610120029`. The real cloud delta revision was 605.

| Boundary | Physical result |
|---|---|
| Kill before update delivery | Relay held HTTP 200 cursor `595 → 618` containing revision 605, then TINDIO was force-stopped. The relay recorded client closure. Cold restart remained at cursor 595 with two cached products; no false success occurred. |
| Update replay | Normal replay again requested cursor 595 and advanced to 625. The device showed the v2 name and PHP 2.00. Old barcode `202610120028` and old SKU `MOB10-A28-001` returned no match; the new barcode and SKU resolved to the same v2 product. |
| Kill after update commit | A second force-stop/cold-start retained cursor 625, no sync error, zero unresolved transactions, and the updated product. |
| Foreign organization response | A one-shot external relay changed only the top-level organization ID of a real HTTP 200 response. The app displayed `DELTA_SCOPE_MISMATCH`, retained cursor 625 and the prior successful-reconcile timestamp, and applied no foreign data. A normal response then advanced safely to 640. |
| Kill before tombstone delivery | The synthetic fixture was archived through the same canonical `set_catalog_product_archived_safely` RPC used by Back Office. Relay held HTTP 200 cursor `640 → 645` with revision 642 and `items: []`, then TINDIO was force-stopped. Cold restart remained at cursor 640 and still displayed the cached product, proving no premature deletion. |
| Tombstone replay | Normal replay again requested cursor 640, delivered the same tombstone, and advanced to 653. Only the unrelated Phase 04F product remained. |
| Kill after tombstone commit | Final cold restart retained cursor 653, SQLite integrity `OK`, one cached product, no sync error, READY OFFLINE, outbox `0/0/0/0`, and zero unresolved transactions. |

The full machine-readable evidence is in `evidence/MOB_10_SLICE_06_A28_DELTA_PROCESS_DEATH.json`. Raw UI dumps and relay logs remain uncommitted under `C:\tmp`.

## Database, SQLite, API, security, and custody impact

- Database: one forward `create or replace function` migration; no table/schema reset and no repeated Neon migration. The function remains tenant/store/device scoped and delegates catalog truth to `search_pos_catalog`.
- SQLite: no schema change, manual row edit, reset, or cache deletion. Update and tombstone application used the existing transaction-before-cursor boundary.
- API: POS v2 request and response contracts are unchanged. JSONB decoding now accepts the Neon scalar-object representation as well as the existing array representation.
- Security: the canonical device header is used; the function calls `private.require_pos_sync_access`; the physical app rejected a foreign organization response before advancing its cursor.
- Transaction custody: credentials, offline authorization, device sequence 7, server checkpoint 6, outbox state, and unresolved-transaction custody were preserved throughout. No sale/payment/receipt/inventory transaction was created by this catalog-only fixture.

## Repository validation

- Targeted catalog-cache, Phase 12, Phase 18, source-of-truth, and canonical-install checks: 24/24 passed.
- Mobile typecheck: passed.
- Root typecheck: passed.
- Mobile lint: passed with 0 errors and 1 pre-existing warning.
- Root lint: passed with 0 errors and 3 pre-existing warnings.
- Android export: passed; 1,440 modules bundled.
- Static certification: 143/144 automated package commands passed. The unrelated `test:phase-04-docker-source-connectivity` prerequisite failed because local Supabase is unavailable; all A28-related commands passed.

## Remaining limitations

A28 does not certify A48, production signing, Google Play delivery, peripherals, the remaining physical failure matrix, or merchant pilot readiness. A48 remains `NOT_RUN` until the actual Phase 23/24 production release candidate exists.
