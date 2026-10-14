import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => fs.readFileSync(path, "utf8");

async function loadTypeScriptModule(file) {
  const output = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const guardModule = await loadTypeScriptModule(
  "apps/mobile/src/features/hardware/barcode-scan-guard.ts",
);

test("A37 one native scan cannot acquire acceptance twice", () => {
  const guard = guardModule.createBarcodeScanGuard();
  assert.equal(guard.tryAcquire(), true);
  assert.equal(guard.tryAcquire(), false);
  assert.equal(guard.tryAcquire(), false);
});

test("A37 a later intentional scan is accepted after completion", () => {
  const guard = guardModule.createBarcodeScanGuard();
  assert.equal(guard.tryAcquire(), true);
  guard.release();
  assert.equal(guard.tryAcquire(), true);
});

test("A37 camera denial explicitly preserves manual barcode and SKU entry", () => {
  const camera = read("apps/mobile/src/features/hardware/camera-barcode-scanner.tsx");
  const pos = read("apps/mobile/app/(app)/pos.tsx");
  assert.match(camera, /Manual barcode and SKU entry remains available in the POS/);
  assert.match(camera, /Back to POS/);
  assert.match(pos, /placeholder="Barcode or SKU"/);
  assert.match(pos, /onSubmitEditing=\{\(\) =>[\s\S]*void find\(\)/);
  assert.match(pos, /Find local barcode\/SKU/);
});

test("A37 camera and HID paths acquire synchronously before asynchronous lookup", () => {
  const camera = read("apps/mobile/src/features/hardware/camera-barcode-scanner.tsx");
  const pos = read("apps/mobile/app/(app)/pos.tsx");
  const cameraAcquire = camera.indexOf("scanGuard.tryAcquire()");
  const cameraAccept = camera.indexOf("onScanned(value)");
  assert.ok(cameraAcquire >= 0 && cameraAcquire < cameraAccept);
  assert.match(camera, /\.finally\(\(\) => \{[\s\S]*scanGuard\.release\(\)/);

  const hidAcquire = pos.indexOf("hidLookupGuard.tryAcquire()");
  const barcodeLookup = pos.indexOf("await lookupLocalBarcode(", hidAcquire);
  assert.ok(hidAcquire >= 0 && hidAcquire < barcodeLookup);
  assert.match(pos.slice(hidAcquire, pos.indexOf("const find =", hidAcquire)), /finally[\s\S]*hidLookupGuard\.release\(\)/);
});

test("A37 scanner guards remain outside transaction authority", () => {
  const guard = read("apps/mobile/src/features/hardware/barcode-scan-guard.ts");
  const camera = read("apps/mobile/src/features/hardware/camera-barcode-scanner.tsx");
  assert.doesNotMatch(
    guard + camera,
    /checkout|outbox|payment|inventory|receipt|device_sequence|idempotency/i,
  );
});
