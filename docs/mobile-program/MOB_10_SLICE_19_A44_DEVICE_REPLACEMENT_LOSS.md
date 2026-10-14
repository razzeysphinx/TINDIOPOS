# MOB-10 Slice 19 — A44 device replacement and loss custody

Status: **A44 PASS**

Starting commit: `93e7753bb807ecb49b4261f4eca8de26c75f8321`

## Observed defect

Fleet Management exposed only a generic device revoke action. It did not require an operator to distinguish a fully reconciled terminal from a lost or unavailable terminal, did not prove reconciliation from current authoritative telemetry, and did not record an explicit bounded-loss decision for local-only transactions that cannot be recovered from the device. The existing MOB-08 trigger correctly blocked a generic revoke while ACTIVE shift custody existed, but there was no safe product path for a genuinely lost device.

## Architecture decision

**KEEP + HARDEN.** Preserve the existing device registry, sync telemetry, MOB-08 custody leases and finalization guards, provider-neutral identity, Neon authority, and Fleet Management surface.

Device retirement now requires one of two server-authoritative decisions:

- `RECONCILED`: permitted only when no ACTIVE custody exists and recent cloud telemetry proves zero queued, conflict, and failed work, with the device checkpoint no later than the server checkpoint.
- `DEVICE_UNAVAILABLE_ACCEPT_BOUNDED_LOSS`: requires a specific reason and the exact phrase `ACCEPT LOCAL-ONLY TRANSACTION LOSS`. ACTIVE custody becomes durable `LOST` evidence with actor, time, and reason; it is never deleted.

The audit record states `store_hub_financial_backup=false`. A replacement terminal must enroll with a new device identity and secret. The legacy revoke RPC remains present but fails safely with an explicit decision-required response.

## Changed files

- `database/migrations/0018_mobile_device_retirement_custody.sql`
- `src/features/devices/device-schema.ts`
- `src/features/devices/actions.ts`
- `src/features/devices/device-manager.tsx`
- `src/lib/supabase/database.types.ts`
- `scripts/mobile-a44-device-retirement-custody.test.mjs`
- `scripts/apply-mobile-device-retirement-custody.mjs`
- `scripts/mobile-a44-device-retirement-live.mjs`
- `scripts/mobile-a33-custody-guard.mjs`
- `scripts/phase-25-device-fleet-check.mjs`
- `package.json`
- this evidence document

## Database, SQLite, API, security, and custody impact

- Canonical Neon migration `0018` is installed on branch `r6-clean-canonical-20261002`.
- The private custody table adds nullable loss-decision time, actor, and reason columns and extends its state constraint with `LOST`.
- No SQLite schema or mobile transaction row changes.
- No sale, payment, receipt, inventory movement, outbox event, checkout identity, device sequence, sync cursor, credential, recovery row, or finalization token is deleted or rewritten.
- The new authenticated RPC is organization scoped, requires `devices.manage`, locks the active device row, and receives execute permission only through `tindio_authenticated`.
- Existing generic revoke callers fail closed. Existing device enrollment and telemetry contracts are unchanged.
- The canonical apply script rehearsed the migration with rollback before installation and verified protected row counts before and after installation.
- Neon's branch-level Data API schema cache was explicitly refreshed after the live run reproduced `PGRST202`; the fixture then resumed with the same device and ACTIVE custody identity. No fixture reset or replacement occurred.

## Canonical Neon live evidence

Synthetic fixture:

| Field | Value |
|---|---|
| Organization | `baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9` |
| Shift | `d2cd3c24-543c-415f-9d97-a2ca92ff6e4e` |
| Device | `8943da6f-f142-4792-b962-d6990939084e` |
| Fixture continuation | resumed the same preserved ACTIVE custody record |

The live assertions proved:

- `RECONCILED` was rejected with SQLSTATE `23514` while ACTIVE custody existed.
- unavailable-device retirement without the exact loss phrase was rejected with SQLSTATE `23514`.
- the explicit bounded-loss decision revoked the device and changed exactly one custody lease from `ACTIVE` to `LOST`.
- loss actor and reason were recorded.
- the audit entry recorded the decision, one lost custody record, and `store_hub_financial_backup=false`.
- financial counts were identical before and after: sales `1113`, payments `1113`, receipts `1113`, inventory movements `1118`.

The existing A33 live guard then proved the original certification device remained active, its separate custody lease remained `ACTIVE`, its shift remained open, generic shift close remained blocked, and legacy revoke returned the explicit decision-required response. Its financial counts were unchanged.

## Regression results

- A44 behavioral suite: **4/4 passed**.
- Canonical Neon migration rehearsal: **passed and rolled back**.
- Canonical Neon migration installation: **passed**; protected row counts unchanged.
- Canonical Neon A44 live fixture: **passed**.
- Canonical Neon A33 custody guard: **passed**.
- Phase 25 fleet contract: **5/5 passed**.
- MOB-08 finalization custody: **6/6 passed**.
- MOB-08 server custody leases: **6/6 passed**.
- Phase 16 isolated-device contract: **1/1 passed**.
- Phase 17 sync control contract: **1/1 passed**.
- Phase 18 disaster model: **11/11 passed**.
- Phase 18 production contract: **1/1 passed**.
- Root typecheck: **passed**.
- Mobile typecheck: **passed**.
- Lint: **passed with 0 errors and 3 pre-existing warnings**.
- Production-profile Android export: **passed**, Hermes bundle with 1,446 modules.
- Static repository certification: **154/155 automated package commands passed**. The sole failure was `test:phase-04-docker-source-connectivity` because the local Supabase source was unavailable; it is unrelated to A44.
- `git diff --check`: **passed**.

## Acceptance result and limitations

| Acceptance ID | Result | Reason |
|---|---|---|
| A44 | **PASS** | Canonical Neon and the real authenticated Data API enforced an explicit reconciled-or-bounded-loss decision, preserved durable loss evidence, kept financial history unchanged, and retained the existing MOB-08 custody guards. |

This policy cannot recover transactions that existed only on a physically unavailable device; it makes that unavoidable limitation explicit and audited. Store Hub remains stock-awareness metadata, not a complete financial backup. This slice does not provide physical lost-hardware evidence, a production-signed AAB, Google Play delivery, or A48 evidence. A48 remains **NOT_RUN**.

## Next smallest safe slice

Proceed to A45: exercise production observability for crash, ANR, API outage, and stale-queue signals without logging transaction payloads or weakening tenant/device boundaries. Do not start A48 in that slice.
