# MOB-10 Slice 18 — A43 old-client backend compatibility

Status: **A43 PASS**

Starting commit: `c53c2e6e240baeba700eeb1f9a0e57499042082b`

Older supported client baseline: `bd18a3c88862ce0265d31c5e749d2257b57dac49`

## Observed defect

The audit-baseline mobile client sends shift close as `{ shiftId, countedCash, closingNote? }`. MOB-08 correctly hardened current shift close to require device credentials, an acknowledged local sequence high-water mark, and an immutable finalization token. The upgraded backend rejected the old body through a generic ordinary failure, with no machine-readable indication that retrying unchanged could never succeed.

Restoring the old close behavior would bypass custody safety. The safe compatibility behavior is an authenticated, permission-checked, non-mutating upgrade response.

## Architecture decision

**KEEP + HARDEN.** Keep POS v2, the authoritative shift-close service/RPC, current MOB-08 custody protocol, provider-neutral identity, and all established checkout/sync identities.

The server now recognizes only the exact legacy close family: string `shiftId` and `countedCash`, with all three custody fields absent. After authentication and `shifts.close` permission checking—but before current-schema validation, database-client creation, or RPC execution—it returns:

```json
{
  "ok": false,
  "code": "POS_CLIENT_UPGRADE_REQUIRED",
  "requiredCapability": "SHIFT_CUSTODY_FINALIZATION_V1",
  "retryable": false,
  "preservesRecovery": true,
  "message": "Update TINDIO POS before closing this shift. The shift remains open and pending transactions are preserved."
}
```

HTTP status is `426`. Partially malformed current requests do not impersonate the legacy client and remain subject to normal validation.

## Changed files

- `src/contracts/pos.ts`
- `src/features/shifts/mobile-shift-close-compatibility.ts`
- `src/features/shifts/service.ts`
- `src/app/api/pos/v2/shifts/close/route.ts`
- `scripts/mobile-a43-old-client-compatibility.test.mjs`
- `scripts/mobile-a43-old-client-live.mjs`
- `docs/mobile-program/PHASE_23_ANDROID_RELEASE_UPDATE_POLICY.md`
- `package.json`
- this evidence document

## Database, API, security, and custody impact

- Neon/database migrations: none.
- SQLite migrations or mutations: none.
- Existing POS v2 route paths: unchanged.
- Successful current shift-close contract: unchanged.
- Audit-baseline checkout, offline-checkout, ordered sync-push, bootstrap, catalog, reference, and live route sources remain unchanged from the baseline commit.
- Authentication and `shifts.close` permission checks remain mandatory before the compatibility decision.
- The legacy response performs no business-database mutation and cannot close a shift.
- No outbox event, checkout identity, receipt, recovery row, device sequence, synchronization cursor, credential, or finalization guard is deleted or rewritten.

## Behavioral and live evidence

The A43 automated suite passed **3/3**:

- exact audit-baseline shift-close body maps to the explicit upgrade response;
- current custody-complete and malformed partial-current bodies are not classified as legacy;
- permission checking precedes compatibility classification, which precedes validation and database access.

The exact audit-baseline body was then sent through the running current Next.js route using the configured certification identity and canonical organization context. The live HTTP assertion returned:

```json
{
  "acceptanceId": "A43",
  "baselineCommit": "bd18a3c88862ce0265d31c5e749d2257b57dac49",
  "endpoint": "/api/pos/v2/shifts/close",
  "status": 426,
  "code": "POS_CLIENT_UPGRADE_REQUIRED",
  "retryable": false,
  "preservesRecovery": true
}
```

The request used a synthetic nonexistent shift ID. The compatibility decision occurred before creation of the business database client, so no shift, money, inventory, receipt, or custody mutation was attempted.

## Regression results

- A43 behavioral suite: **3/3 passed**.
- Live authenticated old-contract request: **passed**, HTTP 426 with exact response above.
- MOB-08 finalization custody: **6/6 passed**.
- MOB-08 server custody leases: **6/6 passed**.
- Phase 01 POS API contract: **6/6 passed**.
- Phase 03 shared contracts: **7/7 passed**.
- Phase 04 V1 retirement: **5/5 passed**.
- Phase 23 Android hardening: **6/6 passed**.
- Mobile typecheck: **passed**.
- Root typecheck: **passed**.
- Lint: **passed with 0 errors and 3 pre-existing warnings**.
- Production-profile Android export: **passed**, Hermes bundle with 1,446 modules.
- Static repository certification: **153/154 automated package commands passed**. The sole failure was `test:phase-04-docker-source-connectivity` because the local Supabase source was unavailable; it is unrelated to A43.
- `git diff --check`: **passed**.

## Acceptance result and limitations

| Acceptance ID | Result | Reason |
|---|---|---|
| A43 | **PASS** | The real audit-baseline request contract reached the upgraded authenticated backend. Unchanged supported POS v2 operations retain their contract; the one intentionally unsafe legacy mutation receives an explicit pre-mutation upgrade response that preserves recovery. |

This is backend-contract runtime evidence, not a production-signed APK, Google Play delivery, or A48 evidence. It does not relax MOB-08 custody or certify unsupported older versions before the named baseline.

## Next smallest safe slice

Proceed to A44: document and exercise the device-replacement/lost-device custody decision and bounded-loss policy without claiming the current Store Hub contains full financial backup. A48 remains **NOT_RUN**.
