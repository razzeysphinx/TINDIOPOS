# Phase G4 physical release-candidate continuation — 2026-10-27

Status: **PHYSICAL CAMPAIGN PASS — EXTERNAL HARDWARE AND PRODUCTION RELEASE LEGS OPEN**

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

## Isolated fresh-install campaign — 2026-10-28

The physical phone supports secondary Android users. A temporary user was
created to obtain a genuinely clean application-data sandbox without
uninstalling, clearing, or modifying the Owner profile's TINDIO custody. The
validated version-code-4 package was installed for that user and launched with
no prior TINDIO state.

The first launch truthfully reported `PREPARATION REQUIRED` and did not claim
offline readiness. The synthetic certification account then authenticated
through the isolated exact-runtime server. No Owner session or business context
was inherited. The temporary installation selected the existing Certification
Store and Certification Register and completed device enrollment against the
branch-scoped Preview environment.

After enrollment, the fresh installation reported `READY OFFLINE / Connected
to TINDIO`. Removing only `adb reverse tcp:3000` and cold-starting the app then
reported `READY OFFLINE / Using saved store data`. The prepared SQLite catalog,
offline authorization, product search, manual barcode/SKU input, built-in camera
entry, and the synthetic PHP 1.00 catalog item remained visible. No sale was
created.

This passes the fresh-install preparation leg and the prepared-terminal offline
cold-start leg for this local development-signed APK. It does not certify an
external HID scanner, printer, production-signed AAB, or Play distribution.

After capture, the phone switched back to Owner, verified version code 4 and
app-data inode `933936`, and removed only the temporary user. Owner cold-started
back into `SYNC REVIEW` with the original review-required transaction still
visible. The isolated server was stopped, its temporary Preview environment
file was deleted, and the ADB reverse mapping was removed.

## Forced-upgrade HTTP 426 campaign — 2026-10-28

A localhost-only controlled response returned HTTP 426 with code
`POS_CLIENT_UPGRADE_REQUIRED`, required capability
`DUAL_AUTH_TRANSITION_V1`, `retryable: false`, and
`preservesRecovery: true`. No staging or production minimum-version policy was
activated.

The first physical run exposed a real recovery defect: although Auth and local
custody remained installed, the home screen collapsed an update restriction
and unavailable business context into the generic `We couldn't open this
register` screen. Version-code-5 commit
`5eb5a0b1c6b8191c95a43071b961870545a91723` removed the first UI condition but
proved that an expired offline grant still prevented the cached business
snapshot from reaching the home screen.

Commit `020975f2805ddc9998aea4e6bcd6e03926e41e99` corrected the 426-only recovery
path. Its exact-source version-code-6 APK had SHA-256
`48B0A549A4A60CAA3198187120EF726BEB1A23AF9CBC418C0BE2AD68FD82932C`, used the
same development signer, targeted SDK 36, contained only `arm64-v8a`, passed APK
Signature Scheme v2 verification, and passed ZIP alignment verification.

Android accepted the in-place version 5 to 6 installation without uninstalling
or clearing data. The first-install timestamp remained
`2026-10-17 11:41:08`. Under the same HTTP 426 response, the physical app then
displayed the preserved register workspace with `EXPIRED / RECONNECT REQUIRED`,
`Using saved store data`, and a separate `Update required` restriction. New
offline sales remained paused.

`Sync & Recovery` remained reachable and truthfully reported `Needs review: 1`,
`Offline readiness: EXPIRED`, and that existing receipts and unresolved
transactions remained available. The review-required financial event was not
retried, resolved, deleted, or settled. This passes the physical forced-upgrade
recovery leg while leaving production policy activation out of scope.

## Auth-provider selector rollback campaign — 2026-10-28

The provider rollback used the same installed Owner profile and the same
development signing certificate; it did not uninstall, clear data, sign out
the legacy Supabase session, retry the held financial event, or change a
deployed selector. Version-code-7 selected Neon only inside the guarded local
proof configuration and used the existing isolated Phase E Neon Auth branch.
Its APK SHA-256 was
`BFE101A82635C7DE84408756CDECBBED2FE5F4EA9129E926C7208E702BF57515`.

A temporary `.invalid` identity completed live password sign-in. Under the
localhost-only HTTP 426 API boundary, the app stored the Neon provider session
without gaining a mutation path. A cold restart restored that session,
displayed the saved Certification Store/Register workspace, and reported
`NEON ACTIVE`. Release Diagnostics then armed an upgrade proof containing both
provider sessions, the enrolled device, expired offline grant, one unsynced
event, one immutable receipt, one sequence checkpoint, and SQLite schema 13.

Version-code-8 restored the Supabase selector. Its arm64 APK SHA-256 was
`AE3B0BC553D39099F6F152D62ADC3E00E18F4C639EEED805ED68F233FA82610C`.
Android accepted the in-place `6` to `7` to `8` sequence and retained the
original first-install timestamp, `2026-10-17 11:41:08`. The original Supabase
session resumed without credentials and Release Diagnostics reported
`SUPABASE ACTIVE`.

The built-in verifier then reported:

> Upgrade proof passed: Auth SUPABASE_ACTIVE; session, enrollment, offline
> grant, 1 event(s), receipts, and sequence checkpoints preserved; schema 13
> to 13.

Because the proof was armed while both the legacy Supabase session and Neon
cookie were present, the verifier would have failed with
`AUTH_SESSION_MISSING` if either had disappeared. This therefore proves the
rollback preserved both provider sessions as well as financial custody. All
temporary synthetic identities were removed, the encrypted local credential
file was deleted, the app was stopped, the ADB reverse mapping was removed,
and the controlled server was stopped.

## Remaining boundaries

- External HID scanner and receipt-printer checks are `BLOCKED_NO_HARDWARE`.
- Production signing, Play delivery, AAB qualification, and A48 remain
  `NOT_RUN`.
- Production Auth activation, supported-client enforcement, and provider
  retirement remain separately owner-gated and were not changed.
- The review-required transaction was not retried, resolved, deleted, or
  financially settled by this campaign.

Machine-readable evidence is recorded in
`phase-g4-physical-release-candidate-2026-10-27.json`.
