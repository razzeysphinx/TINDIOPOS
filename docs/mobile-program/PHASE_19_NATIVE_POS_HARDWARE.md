# Phase 19 — Native POS Hardware

## Implementation status

**IMPLEMENTATION COMPLETE**

## Certification status

**VALIDATING**

Real-device certification remains required.

## Source-of-Truth gate

```text
Hardware failures cannot corrupt transactions.
```

## Architecture

Hardware is outside transaction authority:

```text
INPUT HARDWARE
↓
TINDIO BUSINESS LOGIC
↓
DURABLE / AUTHORITATIVE TRANSACTION
↓
OPTIONAL OUTPUT HARDWARE SIDE EFFECT
```

Hardware callbacks do not own:

- sale commit
- payment ledger
- inventory ledger
- durable outbox
- device sequence
- cloud acknowledgement

## Implemented input hardware

### Camera barcode scanner

Native mobile uses `expo-camera` and feeds a scanned barcode into the existing local SQLite barcode lookup.

The scanner does not mutate inventory.

It only identifies the product to add through existing POS logic.

### USB / Bluetooth barcode scanners

Scanners operating as Android keyboard/HID wedges are supported through the existing barcode/SKU input.

A scanner that emits Enter can submit the lookup directly.

This avoids unnecessary vendor coupling for standard HID devices.

## Hardware adapter boundaries

Contracts exist for:

- Bluetooth receipt printers
- USB receipt printers
- LAN receipt printers
- cash drawers
- customer displays
- KDS
- payment terminals

Provider-specific transports are intentionally not fabricated.

They must be implemented behind the adapter interfaces when actual target hardware/providers are selected.

## Payment terminal boundary

Phase 19 does not implement offline electronic card payments.

The payment terminal adapter accepts only:

- operation ID
- amount
- currency

It does not accept raw:

- PAN
- card number
- CVV/CVC

Offline electronic payment policy remains Phase 20.

## Hardware failure behavior

A hardware failure may result in:

```text
FAILED HARDWARE ACTION
OPERATOR WARNING
RETRY HARDWARE ACTION
```

It must not:

- undo an already committed sale
- create another sale
- create another payment
- duplicate inventory movement
- delete an unresolved outbox event
- turn a Store Hub ACK into a cloud ACK
- make printer success equivalent to transaction success

## Support matrix

```text
Camera barcode scanner    IMPLEMENTED
HID barcode scanner       OS MANAGED
Bluetooth printer         ADAPTER REQUIRED
USB printer               ADAPTER REQUIRED
LAN printer               ADAPTER REQUIRED
Cash drawer               ADAPTER REQUIRED
Customer display          ADAPTER REQUIRED
KDS                       ADAPTER REQUIRED
Payment terminal          ADAPTER REQUIRED
```

## Why adapters are required

Printer, drawer, display, KDS, and payment-terminal transports vary by:

- manufacturer
- Android USB/Bluetooth protocol
- network protocol
- vendor SDK
- payment provider
- merchant hardware choice

TINDIO therefore keeps device-specific code behind adapters instead of embedding it in checkout/domain logic.

## Database impact

Server database migration:

```text
NONE
```

Mobile SQLite migration:

```text
NONE
```

## Certification still required

- camera permission denial
- camera scan on real Android hardware
- common EAN/UPC/Code128 barcodes
- physical USB HID scanner
- physical Bluetooth HID scanner
- scanner disconnect/reconnect
- unsupported printer adapter
- configured printer failure after committed sale
- cash drawer failure after committed sale
- customer display transport failure
- KDS transport failure
- payment terminal provider failure
- app restart after hardware failure

## Phase status

```text
PHASE 19
IMPLEMENTATION COMPLETE
STATUS: VALIDATING
CERTIFICATION: NOT CERTIFIED
```

Next canonical phase after review:

```text
PHASE 20 — OFFLINE PAYMENTS + RISK ENGINE
```