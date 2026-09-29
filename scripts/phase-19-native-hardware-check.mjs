import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) =>
  fs.readFileSync(
    path,
    "utf8",
  );

test(
  "Phase 19 native hardware adapter contract",
  () => {
    const packageJson =
      JSON.parse(
        read(
          "apps/mobile/package.json",
        ),
      );

    const appConfig =
      read(
        "apps/mobile/app.json",
      );

    const contracts =
      read(
        "apps/mobile/src/features/hardware/hardware-contracts.ts",
      );

    const safeAction =
      read(
        "apps/mobile/src/features/hardware/hardware-safe-action.ts",
      );

    const camera =
      read(
        "apps/mobile/src/features/hardware/camera-barcode-scanner.tsx",
      );

    const pos =
      read(
        "apps/mobile/app/(app)/pos.tsx",
      );

    const hardwareScreen =
      read(
        "apps/mobile/app/(app)/hardware.tsx",
      );

    assert.ok(
      packageJson.dependencies[
        "expo-camera"
      ],
      "Expo camera dependency must be installed",
    );

    assert.ok(
      appConfig.includes(
        '"expo-camera"',
      )
      && appConfig.includes(
        "cameraPermission",
      )
      && appConfig.includes(
        '"recordAudioAndroid": false',
      ),
      "camera permission must be configured without unnecessary audio recording",
    );

    for (
      const capability of [
        "CAMERA_BARCODE_SCANNER",
        "HID_BARCODE_SCANNER",
        "BLUETOOTH_PRINTER",
        "USB_PRINTER",
        "LAN_PRINTER",
        "CASH_DRAWER",
        "CUSTOMER_DISPLAY",
        "KDS",
        "PAYMENT_TERMINAL",
      ]
    ) {
      assert.ok(
        contracts.includes(
          capability,
        ),
        `hardware contract must include ${capability}`,
      );
    }

    assert.ok(
      contracts.includes(
        "ReceiptPrinterAdapter",
      )
      && contracts.includes(
        "CashDrawerAdapter",
      )
      && contracts.includes(
        "CustomerDisplayAdapter",
      )
      && contracts.includes(
        "KdsAdapter",
      )
      && contracts.includes(
        "PaymentTerminalAdapter",
      ),
      "hardware integrations must use adapter boundaries",
    );

    assert.doesNotMatch(
      contracts,
      /\bpan\b|cardNumber|cvv|cvc/i,
      "payment terminal contract must not accept forbidden raw card fields",
    );

    assert.doesNotMatch(
      safeAction,
      /checkout|outbox|inventory|supabase|store-hub/i,
      "hardware failure boundary must remain outside business transaction authority",
    );

    assert.ok(
      camera.includes(
        "CameraView",
      )
      && camera.includes(
        "onBarcodeScanned",
      ),
      "camera barcode scanning must be real, not a placeholder",
    );

    assert.ok(
      pos.includes(
        "Scan barcode with camera",
      )
      && pos.includes(
        "onSubmitEditing",
      )
      && pos.includes(
        "keyboard/HID wedges",
      ),
      "POS must expose camera and HID scanner input",
    );

    assert.ok(
      hardwareScreen.includes(
        "Hardware adapters are isolated from transaction authority.",
      ),
      "hardware diagnostics must state the transaction boundary",
    );

    for (
      const forbidden of [
        "checkoutPosV2",
        "enqueueSaleCompletedEvent",
        "syncOutboxEvents",
        "UPDATE inventory",
        "DELETE FROM outbox_events",
      ]
    ) {
      assert.doesNotMatch(
        contracts
          + safeAction
          + camera,
        new RegExp(
          forbidden.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&",
          ),
          "i",
        ),
        `hardware layer must not contain ${forbidden}`,
      );
    }
  },
);