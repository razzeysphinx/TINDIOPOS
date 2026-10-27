# Phase G4 physical release-candidate continuation — 2026-10-27

Status: **PARTIAL PASS — IN-PLACE UPGRADE AND BINARY ROLLBACK PASS; EXTERNAL LEGS OPEN**

## Scope

This continuation exercised the frozen runtime source commit
`0618b02ea7697913722f12399b0e295a02a902a1` on the authorized physical
Android device. It did not change production, close the supported-client
window, switch the Auth provider, clear application data, or execute a
financial retry.

The local certification APK was built from the frozen source in a disposable
short-path copy for the connected ARM64 device. The generated native project
used version code `4`, the repository's existing development signing identity,
and a localhost-only cleartext allowance for `adb reverse`. Those generated
overrides were not committed and are not a production release configuration.

## Artifact identity

| Field | Result |
| --- | --- |
| Runtime source commit | `0618b02ea7697913722f12399b0e295a02a902a1` |
| Package | `com.tindio.pos` |
| Version | `1.0.0` (`versionCode` 4) |
| ABI | `arm64-v8a` |
| min / target / compile SDK | 24 / 36 / 36 |
| APK SHA-256 | `0594D0C2F02FAF0C6C7434F14ABD359206A9D5A3CB53A8497D7DF54AD95B0339` |
| Signer certificate SHA-256 | `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c` |
| APK Signature Scheme v2 | PASS |
| 16 KB ZIP alignment | PASS |
| Installed APK equals validated APK | PASS |

This signer is the repository's existing development identity, not the
production Google Play signing identity. This APK is therefore physical
qualification evidence, not A48 or production-AAB evidence.

## Physical in-place upgrade

The saved version-code-3 APK was first pulled from the device and retained as
the rollback artifact. The version-code-4 candidate was installed with
`adb install -r`; no uninstall or data clear occurred.

| Assertion | Result |
| --- | --- |
| Version transition | PASS — `3` to `4` |
| First-install identity | PASS — unchanged from `2026-10-17 11:41:08` |
| App-data inode | PASS — unchanged at `933936` |
| Exact installed candidate hash | PASS |
| Auth transition after reauthentication | PASS — `SUPABASE_ACTIVE` |
| SQLite schema | PASS — `13` to `13` |

Before the upgrade, Release Diagnostics had armed a proof containing one
unsynced event, one receipt, one sequence checkpoint, the current Auth state,
and schema 13. After the upgrade, the built-in verifier reported:

> Upgrade proof passed: Auth SUPABASE_ACTIVE; session, enrollment, offline
> grant, 1 event(s), receipts, and sequence checkpoints preserved; schema 13
> to 13.

The synthetic account authenticated successfully. The exact-SHA local Next
server used the branch-scoped `TINDIO-PREPRODUCTION` Preview environment and
the isolated Neon Data API target through `adb reverse tcp:3000 tcp:3000`.

## Custody and recovery state

The retained transaction remained visible after the upgrade. Sync and
Recovery truthfully reported zero waiting items and one item requiring review.
The server classified it as `PERMISSION_CHANGED`, so no automatic retry was
performed. The receipt, local event, sequence continuity, and checkpoints
remained available. Resolving that entry requires the existing manager-note
workflow and is intentionally outside this non-financial upgrade proof.

## Binary rollback rehearsal

The saved version-code-3 baseline had the same package and signer. Android
accepted `adb install -r -d`, producing a physical `4` to `3` rollback without
changing the first-install identity or app-data inode. The rolled-back binary
cold-started with the authenticated business context and truthfully displayed
`SYNC REVIEW` for the retained transaction.

The exact validated version-code-4 APK was then reinstalled with
`adb install -r`. Version `4` cold-started successfully, retained inode
`933936`, and continued to expose the saved transaction for review. This is a
binary rollback/re-upgrade rehearsal only; it is not the Phase G4 Auth-provider
selector rollback campaign.

## Remaining boundaries

- Fresh install is `NOT_RUN`: the only connected device holds preserved
  certification custody, and no destructive reset was authorized.
- Physical forced-upgrade HTTP 426 behavior is `NOT_RUN` for this APK pair.
- Auth-provider selector rollback is `NOT_RUN` and remains separately gated.
- External HID scanner and receipt-printer checks are `BLOCKED_NO_HARDWARE`.
- Production signing, Play delivery, AAB qualification, and A48 remain
  `NOT_RUN`.
- The review-required transaction was not retried, resolved, deleted, or
  financially settled by this campaign.

Machine-readable evidence is recorded in
`phase-g4-physical-release-candidate-2026-10-27.json`.
