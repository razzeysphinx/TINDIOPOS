# TINDIO POS Android v1 hardware support

This is the canonical hardware language for the Android v1 product, reviewer
instructions, support material, and Google Play listing.

## Supported

| Capability | v1 status | Notes |
| --- | --- | --- |
| Manual barcode/SKU entry | `SUPPORTED` | Uses the existing local catalog field and requires no peripheral. |
| Built-in Android camera barcode scanning | `SUPPORTED_BUILT_IN` | Uses the device camera and the same local catalog/cart path. Camera permission is optional; manual entry remains available when denied. |

## Unsupported in v1

| Capability | v1 status | Reopening requirement |
| --- | --- | --- |
| USB/Bluetooth HID barcode scanner | `UNSUPPORTED_V1` | Select exact models and pass physical scan, duplicate, disconnect, and reconnect testing on the release binary. |
| Bluetooth receipt printer | `UNSUPPORTED_V1` | Select exact model/SDK and certify pairing, encoding, paper width, cut, paper-out, reconnect, and independent retry. |
| USB receipt printer | `UNSUPPORTED_V1` | Select exact model/transport and certify Android USB permission, reconnect, paper-out, and independent retry. |
| LAN receipt printer | `UNSUPPORTED_V1` | Select exact model/protocol and certify network loss, reconnect, paper-out, and independent retry. |
| Cash drawer | `UNSUPPORTED_V1` | Select exact printer/drawer interface and prove a drawer failure cannot alter transaction custody. |
| Customer display | `UNSUPPORTED_V1` | Select exact transport and certify failure isolation. |
| KDS hardware transport | `UNSUPPORTED_V1` | Select exact transport and certify failure isolation from the authoritative sale. |
| Payment terminal | `UNSUPPORTED_V1` | Select a compliant PSP and exact terminal; certify authorization, replay, reboot, settlement, and reconciliation without raw card-data storage. |

The repository retains provider-neutral adapter contracts for later releases.
Those contracts do not constitute supported hardware.

## Product and listing wording

Approved claim:

> TINDIO POS Android v1 supports manual barcode/SKU entry and barcode scanning
> with the Android device's built-in camera. External scanners, receipt
> printers, cash drawers, customer displays, KDS transports, and payment
> terminals are not supported in v1.

Do not advertise compatibility with a manufacturer, model, connection type,
printer command language, drawer interface, or payment terminal until that
exact combination passes its physical release-binary acceptance campaign.

Receipt visibility does not depend on a printer. A print control must never
retry checkout, create another payment, or decide whether a sale committed.
Offline electronic/card payments remain disabled.
