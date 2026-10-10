# MOB-10 slice 04 — A42 in-place upgrade

## Result

`A42 PASS` on the physical Android baseline device. An unresolved offline cash sale created on SQLite schema 12 and versionCode 1 survived an in-place `adb install -r` upgrade to schema 13 and versionCode 2. The application verified the original event identity, idempotency key, device sequence, payload, and receipt snapshot before reconnecting. Reconnection posted the event exactly once.

The authoritative checkout did not create a sale: Neon classified the single attempt as `INVENTORY_CONFLICT` because the synthetic certification item had insufficient authoritative stock and the store blocks negative stock. That is a valid fail-closed outcome for A42. The local transaction remains visible in `CONFLICT` for product-controlled review, and a subsequent cold restart did not post it again.

This is physical APK evidence, not A48 evidence. Neither APK was production signed or Play delivered.

## Phase and ticket

- Phase: Mobile Phase 23, with Phase 07 and Phase 18 custody coverage
- Ticket: MOB-10
- Acceptance case: A42 — in-place binary upgrade with unresolved sale and old schema
- Starting commit: `3b5be63633de30e37b55d2ed444fb02d63f1a912`
- Implementation commit: `b41461353e4b0ba64105d2f0311cac29c8ff7c94`

## Observed defect / missing evidence

The source already had transactional SQLite migrations and durable outbox behavior, but it had no controlled schema upgrade fixture or physical evidence that a real unresolved sale survived a binary replacement and retained the same financial identity through reconnect.

## Architecture decision

`KEEP + HARDEN`. Keep Expo/React Native, SQLite, the POS v2 API, Supabase Auth, and Neon authority. Add one non-destructive schema migration and an upgrade proof that hashes and compares the protected event before and after installation. Do not reset SQLite, recreate the event, replace its idempotency key, or bypass authoritative checkout policy.

## Changed files

Implementation commit `b414613` changes the Android versionCode, advances SQLite schema 12 to 13 with a partial index over unresolved outbox custody, updates schema-version contracts, and adds real-SQLite migration regression coverage. The exact implementation file list is available with:

```text
git show --stat --oneline b414613
```

This evidence slice adds:

- `docs/mobile-program/MOB_10_SLICE_04_A42_IN_PLACE_UPGRADE.md`
- `docs/mobile-program/evidence/MOB_10_SLICE_04_A42_IN_PLACE_UPGRADE.json`

## Database, SQLite, and API compatibility

- SQLite migration: 12 → 13.
- Migration action: adds `idx_outbox_upgrade_custody`; it performs no `DELETE`, `DROP`, `UPDATE`, or `INSERT`.
- The real-SQLite test proves the unresolved row remains byte-for-byte unchanged across migration.
- Neon schema: unchanged.
- POS v2 API contract: unchanged.
- Supabase Auth and provider-neutral identity: unchanged.
- The server remained authoritative and returned a policy conflict without creating sales, payments, receipts, checkout requests, or inventory movements.

## Security and transaction-custody impact

- No uninstall, app-data clear, database reset, logout, device reenrollment, or shift close occurred.
- Android `firstInstallTime` remained `2026-10-09 22:13:25` throughout the upgrade sequence.
- Pre-upgrade proof: `UPGRADE PROOF ARMED — 1 UNSYNCED EVENT(S) — SCHEMA 12`.
- Post-upgrade proof: `UPGRADE PROOF PASS — 1 EVENT(S) PRESERVED — SCHEMA 12 -> 13`.
- Synthetic local reference: `OFF-801CB32386`, device sequence 1, amount PHP 1.00.
- Reconnect created exactly one `offline_sync_events` row and one `pos_device_sequence_receipts` row, both classified `CONFLICT` after the negative-stock decision.
- A second cold start left the backend `/sync/push` count at 1 and the Neon counts unchanged.
- The local outbox is now `0 pending / 0 syncing / 1 conflict / 0 failed`; custody remains visible and recoverable.
- No tenant/store scope or device secret was exposed in committed evidence.

## Physical Android evidence

- Device: Xiaomi 21121210G, Android 14 / API 34, ARM64-v8a.
- Kernel page size: 4096 bytes.
- Baseline: versionCode 1, SQLite 12, prepared authenticated terminal.
- Successor: versionCode 2, SQLite 13, same package and debug signer.
- Install method: `adb install -r`; result `Success`.
- Package: `com.tindio.pos`; min SDK 24; target/compile SDK 36.
- Signer SHA-256: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
- Initial ARM64 upgrade artifact SHA-256: `A3306CEFFAC1207D1F619EBF197DCBAA2ACCA5E4294ACBE57B9E703A062C185F`.
- The laptop DHCP address changed after upgrade. A same-source, same-version, same-signer test APK was therefore installed in place with only the local development endpoint refreshed. Its SHA-256 is `D74F3FAB588FFC94D3E9277F0A6B2BA804EBCA49D7A5872BDD2D6CDE9A939AE6`.
- Final app-process fatal log count: 0.

## Authoritative reconnect evidence

The first reachable recovery executed one bootstrap, device validation, `/sync/push`, and checkpoint request. The push returned HTTP 200. Read-only Neon inspection then reported:

```json
{
  "offline_sync_events": 1,
  "sync_states": ["CONFLICT"],
  "sequence_receipts": 1,
  "sequence_states": ["CONFLICT"],
  "checkout_requests": 0,
  "sales": 0,
  "payments": 0,
  "receipts": 0,
  "inventory_movements": 0,
  "conflict_type": "INVENTORY_CONFLICT",
  "attempt_count": 1
}
```

After another cold restart, the server push count remained 1 and a second read-only Neon audit returned the same counts. This proves one post and no duplicate financial or inventory mutation. It does not claim that the deliberately rejected sale became official.

## Tests and exact results

- Mobile SQLite durability: 6/6 passed.
- Mobile outbox coordinator: 5/5 passed.
- Mobile outbox recovery: 5/5 passed.
- Mobile local receipts: 5/5 passed.
- Phase 07 complete: 1/1 passed.
- Phase 10: 1/1 passed.
- Phase 11: 1/1 passed.
- Phase 12: 1/1 passed.
- Phase 18 disaster model: 11/11 passed.
- Phase 18 production contract: 1/1 passed.
- Phase 23 Android hardening: 6/6 passed.
- Mobile typecheck: passed.
- Root typecheck: passed.
- Lint: passed with 0 errors and 3 pre-existing warnings.
- Android export: passed.
- Native `assembleRelease`: passed after regenerating disposable CMake caches and forcing the corrected development bundle.
- APK signature v2 and 16 KB zip alignment checks: passed.
- Static certification: 142/143 automated package commands passed; only `test:phase-04-docker-source-connectivity` failed because the local Supabase source was unavailable.
- `git diff --check`: required after evidence creation and before commit.

## Remaining limitations

- The synthetic sale is intentionally still unresolved because authoritative inventory rejected it. A manager must replenish/adjust stock through supported product controls before any reviewed retry of this same transaction.
- The local development endpoint is DHCP-bound; the endpoint-refresh APK was necessary after the laptop address changed. Production builds enforce HTTPS and are unaffected by this local cleartext test arrangement.
- The tested APK uses a generated debug certificate and is not the production-signed AAB.
- A48, Play delivery, physical 16 KB-page hardware, peripherals, failure-recovery campaign completion, and merchant pilot remain open.
- TINDIO POS is not production certified.

## Commit and next smallest safe slice

- Implementation commit: `b41461353e4b0ba64105d2f0311cac29c8ff7c94`.
- Evidence commit: recorded after final validation.
- Next slice: MOB-10 A48 preparation — produce and inspect the actual production-signed AAB and execute it on required 16 KB-page/target-API hardware. Do not claim A48 from this debug-key APK.
