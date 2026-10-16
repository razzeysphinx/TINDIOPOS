import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("MOB-12 exposes one truthful v1 hardware capability", () => {
  const contracts = read(
    "apps/mobile/src/features/hardware/hardware-contracts.ts",
  );

  assert.equal(
    contracts.match(/support: "SUPPORTED_BUILT_IN"/g)?.length,
    1,
  );
  assert.equal(
    contracts.match(/support: "UNSUPPORTED_V1"/g)?.length,
    8,
  );
  assert.match(
    contracts,
    /capability:\s*"CAMERA_BARCODE_SCANNER"[\s\S]*?support: "SUPPORTED_BUILT_IN"/,
  );
  assert.match(
    contracts,
    /capability:\s*"HID_BARCODE_SCANNER"[\s\S]*?support: "UNSUPPORTED_V1"/,
  );
  assert.match(contracts, /isHardwareSupportedInV1/);
});

test("MOB-12 product UI does not advertise uncertified peripherals", () => {
  const hardware = read("apps/mobile/app/(app)/hardware.tsx");
  const pos = read("apps/mobile/app/(app)/pos.tsx");
  const catalogue = read("apps/mobile/src/features/cashier/cashier-catalogue.tsx");
  const payments = read("apps/mobile/app/(app)/offline-payments.tsx");

  assert.match(hardware, /Camera scanner supported/);
  assert.match(hardware, /Not supported in v1/);
  assert.match(catalogue, /Manual entry and the built-in camera are supported/);
  assert.match(catalogue, /External scanners are not yet certified/);
  assert.doesNotMatch(
    pos,
    /keyboard\/HID wedges can scan into this field/,
  );
  assert.match(payments, /Electronic payments fail closed/);
  assert.match(payments, /No offline card simulation/);
});

test("MOB-12 release documentation uses the same support matrix", () => {
  const support = read(
    "docs/mobile-program/ANDROID_V1_HARDWARE_SUPPORT.md",
  );
  const play = read(
    "docs/mobile-program/PHASE_24_GOOGLE_PLAY_TESTING_RELEASE.md",
  );
  const reviewer = read(
    "docs/mobile-program/GOOGLE_PLAY_REVIEWER_ACCESS.md",
  );

  for (const capability of [
    "USB/Bluetooth HID barcode scanner",
    "Bluetooth receipt printer",
    "USB receipt printer",
    "LAN receipt printer",
    "Cash drawer",
    "Customer display",
    "KDS hardware transport",
    "Payment terminal",
  ]) {
    assert.match(support, new RegExp(capability.replace("/", "\\/")));
  }

  assert.match(support, /Offline electronic\/card payments remain disabled/);
  assert.match(play, /does not claim external HID-scanner support/);
  assert.match(reviewer, /Physical receipt printers are unsupported in v1/);
  assert.doesNotMatch(play, /HID barcode where hardware exists/);
});
