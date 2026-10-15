# MOB-12 Slice 01 — Android v1 hardware support scope

## Phase and ticket

```text
Mobile Phases 19–20
MOB-12 Slice 01
Android v1 supported/unsupported hardware matrix
```

## Starting commit

```text
7cb8d5fed3e03c394d436a57cd479b6e6c9814a4
```

## Observed defect

The application described HID scanners as OS-managed and potentially usable,
while printer, drawer, display, KDS, and payment-terminal capabilities were
shown only as requiring adapters. No exact external model had been selected or
physically certified. That language could be mistaken for a compatibility
claim despite A37 and A38 remaining blocked and A41 being inapplicable.

## Architecture decision

Define one narrow v1 hardware scope:

- manual barcode/SKU entry is supported without a peripheral;
- the Android device's built-in camera barcode path is the only in-scope
  hardware capability;
- external HID scanners, printers, cash drawers, customer displays, KDS
  transports, and payment terminals are explicitly unsupported in v1;
- retain provider-neutral adapter contracts for future exact-model work;
- retain cash-only offline payment and keep electronic offline payment disabled.

The built-in camera remains subject to the actual Phase 23/24 release-candidate
campaign. This slice defines product scope; it does not replace release-binary
or physical evidence.

## Gap matrix

| Classification | Decision |
| --- | --- |
| KEEP | Camera scanner, manual lookup, scan single-flight guard, hardware adapter boundaries, committed receipt snapshots, and cash-only offline payments |
| KEEP + HARDEN | Hardware capability matrix now distinguishes supported built-in capability from unsupported v1 peripherals |
| EXTEND | Product, reviewer, Play-testing, and cashier-facing support language |
| REFACTOR | Phase 19 contract test follows the approved v1 support claim |
| REPLACE | Ambiguous `OS_MANAGED` / `ADAPTER_REQUIRED` product statuses with explicit v1 support states |
| REMOVE | HID scanner compatibility claim from the cashier POS |
| NEW | Canonical Android v1 hardware support document and MOB-12 regression suite |

## Changed files

- hardware capability contracts and v1 support predicate;
- Hardware and POS cashier screens;
- Phase 19 and Phase 24/reviewer documentation;
- canonical Android v1 hardware support matrix;
- Phase 19 contract expectation and MOB-12 tests;
- package test command and this evidence report.

## Database, SQLite, and API compatibility

```text
Neon migration: NONE
SQLite migration/reset: NONE
POS v2 API change: NONE
Supabase Auth change: NONE
Checkout/payment/receipt API change: NONE
Native dependency/config-plugin change: NONE
```

## Security and transaction-custody impact

- No peripheral is permitted to decide whether a transaction committed.
- Printer/drawer/display/KDS adapters remain outside checkout, payment,
  inventory, outbox, and cloud-acknowledgement authority.
- No raw card credential field or PSP bypass was introduced.
- Offline electronic/card payments remain disabled.
- No outbox event, checkout identity, receipt, device sequence, cursor,
  credential, recovery record, or unresolved transaction is changed or removed.

## Tests and exact results

```text
pnpm test:mobile-mob-12-hardware-scope
PASS — 3 tests, 0 failures

node --test scripts/phase-19-native-hardware-check.mjs scripts/phase-20-offline-payment-risk-check.mjs scripts/mobile-a37-hardware-input.test.mjs
PASS — 11 tests, 0 failures

pnpm mobile:typecheck
PASS

pnpm typecheck
PASS

pnpm --dir apps/mobile lint
PASS — 0 errors, 1 pre-existing warning

pnpm lint
PASS — 0 errors, 3 pre-existing warnings

pnpm mobile:export:android
PASS — Hermes Android bundle, 1,451 modules

pnpm certify:static
157/159 automated package commands passed. The Phase 14 final-recovery and
Phase 04 Docker-source-connectivity checks could not run because the local
Supabase source was unavailable. No MOB-12, Phase 19, Phase 20, or A37 test
failed.

git diff --check
PASS
```

The attempted Phase 19/20 package aliases do not exist. Their canonical test
files were run directly as recorded above.

## Acceptance status

| Acceptance ID | Status | Result |
| --- | --- | --- |
| A37 | `BLOCKED` | Camera/manual/duplicate-guard subsets retain their evidence; external HID reconnect remains unsupported and unevidenced. |
| A38 | `BLOCKED` | Physical printers are unsupported in v1 and no printer failure campaign is claimed. |
| A41 | `NOT_APPLICABLE` | No compliant PSP or payment terminal is enabled; offline electronic/card payment remains disabled. |

MOB-12 v1 product-scope decision: **COMPLETE**.

External hardware certification: **DEFERRED / NOT CERTIFIED**.

## Reopening requirements

For any later peripheral, select the exact manufacturer, model, connection
type, SDK/protocol, supported Android versions, and operational owner. Add the
adapter through the existing boundary, test the actual release binary, and
complete the corresponding disconnect/reconnect/retry/reboot acceptance case
before changing `UNSUPPORTED_V1` or advertising compatibility.

## Next smallest safe slice

Proceed to MOB-13. Audit and harden the branded cashier experience, production
release environment, signing/listing inputs, privacy/support paths, and Android
release-candidate prerequisites without claiming A48 or production readiness.
