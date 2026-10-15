# MOB-10 deferred evidence register and roadmap transition

## Decision record

```text
Recorded: 2026-10-15
Branch: TINDIO-PREPRODUCTION
Starting commit: a274d06b8fe91d317a00bced14a6dfa9c7d53096
MOB-10 implementation status: EXECUTABLE SLICES COMPLETE
MOB-10 production certification: OPEN
Next roadmap ticket: MOB-11
```

The independently executable MOB-10 cases are complete. The cases below cannot
be truthfully completed with the hardware, network, organization details,
credentials, or production release candidate currently available. They are
preserved in this register so roadmap implementation can continue without
misrepresenting missing evidence as a pass.

Proceeding to MOB-11 does not waive, pass, delete, or weaken any acceptance
case in this register. Production certification remains blocked until every
applicable case passes against the actual release scope and release candidate.

## Deferred physical and environment evidence

| Case | Current status | Evidence still required | Reopen when |
| --- | --- | --- | --- |
| A34 | `NOT_RUN` | A second enrolled physical terminal retains pending shift sales while final drawer accounting is attempted and safely resolved. | A second physical Android terminal is available. |
| A35 | `NOT_RUN` | Two physical terminals sell the last unit offline; estimates remain honest and the authoritative ledger applies the oversell-conflict policy. | A second physical Android terminal is available. |
| A37 | `BLOCKED` | A real USB or Bluetooth HID scanner disconnects, reconnects, and produces exactly one cart increment per scan. Camera denial, manual entry, duplicate suppression, and custody behavior already passed. | A compatible external HID scanner is available. |
| A38 | `BLOCKED` | A compatible printer disconnect or paper-out occurs after a saved sale; the sale remains committed and print retry cannot create another checkout or financial effect. | A supported receipt printer is available. |
| A39 | `BLOCKED` | A directly reachable Store Hub is exercised through a real router/Wi-Fi WAN outage and physical LAN-link loss. Existing Hub restart, disappearance, scope denial, ACK separation, cloud return, and custody subsets passed. | A phone can reach the Hub directly on a controlled LAN/WAN test network. |
| A40 | `BLOCKED` | The actual release build connects to a merchant-grade hostname through a trusted certificate chain without a global Android cleartext exception. | The trusted Hub hostname, certificate, directly reachable private network, and release candidate are available. |
| A49 | `BLOCKED` | The core sale and recovery flows are exercised on the agreed low-end phone and tablet with hardware keyboard, large text, and TalkBack, proving controls are usable and unclipped. Static accessibility coverage is not physical evidence. | The required device classes and Android accessibility runtime are available. |

## Release-candidate and external-business gates

These cases belong to the eventual Phase 23/24 release candidate. They do not
need to be fabricated before MOB-11, but they remain mandatory before release.

| Case | Current status | Evidence still required | Reopen when |
| --- | --- | --- | --- |
| A46 | `BLOCKED` | A real, monitored Play reviewer account completes the documented fresh-install walkthrough on the exact submitted build. Non-secret owner and verification timestamps must be recorded. | Reviewer credentials and the submitted release candidate exist. |
| A47 | `BLOCKED` | Approved responsible entity, privacy contact, monitored support channel, production domain, operational deletion-request intake, live public URLs, and Play declarations. | Business/legal owners approve the values and the public production origin is deployed. |
| A48 | `NOT_RUN` | The actual production-signed AAB is inspected and run through the required target-API, manifest, native-library, 16 KB compatibility, installation, and Play-delivery checks. | The Phase 23/24 production release candidate exists. |

## Conditional payment case

| Case | Current status | Scope decision |
| --- | --- | --- |
| A41 | `NOT_APPLICABLE` | Offline electronic/card payments remain disabled. If a compliant PSP and supported terminal are added, A41 immediately becomes required and must prove settlement, replay, reboot, duplicate-charge prevention, failure tracking, and prohibited-card-data exclusion. |

## Current first-release scope constraints

Until the deferred cases pass:

- isolated-device offline cash remains the supported offline financial mode;
- offline electronic/card acceptance remains disabled;
- Store Hub must not be advertised or certified as production-ready;
- external HID scanner and receipt-printer support must not be advertised as
  certified hardware support;
- multi-terminal offline last-unit and pending-shift behavior must not be
  represented as physically certified;
- the application must not be called production-ready or promoted to Google
  Play production.

No application feature, database row, SQLite database, outbox event, checkout
identity, device sequence, synchronization cursor, credential, receipt,
recovery record, or unresolved transaction is deleted or reset by this scope
record.

## Completed evidence retained

- A42 in-place upgrade evidence remains `PASS`.
- The MOB-10 physical failure, delta-sync, queue-scale, auth-recovery,
  business-conflict, custody, compatibility, device-loss-policy, and
  operational-alert slices retain their recorded results.
- A50 isolated Neon cloud restore remains `PASS`.
- Source-contract or behavioral tests remain supporting evidence only; they do
  not replace the deferred physical, external, signed-artifact, or Play
  evidence above.

## Roadmap transition rule

MOB-11 may begin as the next separate slice. Its first decision must confirm
whether Store Hub is included in the first-release scope:

1. If included, MOB-11 must close the trusted transport, pairing, token
   rotation, service operation, and real-device Hub evidence, including A39
   and A40.
2. If deferred, preserve the existing Hub implementation, keep it unavailable
   as a certified production feature, document the approved deferral, and
   continue with isolated-device offline cash behavior.

MOB-12 and later tickets may proceed under the same rule: unsupported hardware
can be explicitly excluded from the initial product scope, but its acceptance
case cannot be marked `PASS`. All applicable deferred cases must be reopened
before production certification.

## Source evidence

- `MOB_10_SLICE_14_A37_HARDWARE_INPUT.md`
- `MOB_10_SLICE_15_A38_PRINTER_BLOCKED.md`
- `MOB_10_SLICE_16_A39_STORE_HUB_FAILURES.md`
- `MOB_10_SLICE_17_A40_SECURE_HUB_TRANSPORT.md`
- `MOB_10_SLICE_21_A46_PLAY_REVIEWER_ACCESS.md`
- `MOB_10_SLICE_22_A47_PUBLIC_POLICY_ACCESS.md`
- `MOB_10_SLICE_23_A49_ANDROID_ACCESSIBILITY.md`
- `MOB_10_SLICE_24_A50_CLOUD_RESTORE.md`
- `TINDIO-ACCEPTANCE-MATRIX.md` supplied with the implementation brief

