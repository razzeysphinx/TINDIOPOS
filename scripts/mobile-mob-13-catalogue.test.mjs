import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Slice 09 presents local-first catalogue states without engineering copy", () => {
  const pos = read("apps/mobile/app/(app)/pos.tsx");
  const catalogue = read("apps/mobile/src/features/cashier/cashier-catalogue.tsx");
  assert.match(pos, /<CashierCatalogue/);
  for (const state of ["Opening catalogue", "No products found", "Products unavailable"]) assert.match(catalogue, new RegExp(state));
  for (const signal of ["Enter price", "Options", "Fractional", "Products available offline"]) assert.match(catalogue, new RegExp(signal));
  assert.doesNotMatch(pos, /LOCAL-FIRST POS|Catalog source: SQLite|Store\/register:/);
});

test("Slice 09 preserves local search and product configuration handlers", () => {
  const pos = read("apps/mobile/app/(app)/pos.tsx");
  const local = read("apps/mobile/src/features/local-first/local-catalog.ts");
  for (const marker of ["searchLocalCatalog", "lookupLocalBarcode", "lookupLocalSku", "createBarcodeScanGuard", "startConfigure", "refreshCartStockEstimates"]) assert.match(pos, new RegExp(marker));
  assert.match(local, /SELECT payload_json FROM catalog_items/);
  assert.match(local, /LIMIT \? OFFSET \?/);
  assert.match(local, /Math\.min\([\s\S]*input\.limit \?\? 24/);
});

test("Slice 09 exposes accessible search, categories, products, and responsive grid", () => {
  const catalogue = read("apps/mobile/src/features/cashier/cashier-catalogue.tsx");
  const responsive = read("apps/mobile/src/ui/tindio-responsive.ts");
  assert.match(catalogue, /accessibilityLabel="Search products"/);
  assert.match(catalogue, /accessibilityRole="tab"/);
  assert.match(catalogue, /accessibilityState=\{\{ selected: active \}\}/);
  assert.match(catalogue, /accessibilityHint="Adds this product to the sale"/);
  assert.match(catalogue, /useTindioResponsiveLayout/);
  assert.match(responsive, /allowsDenseGrid: width >= 600 && !isLargeText/);
  assert.match(catalogue, /minHeight: tindioTheme\.target\.minimum/);
});

test("Slice 09 preserves camera and HID duplicate suppression plus manual fallback", () => {
  const camera = read("apps/mobile/src/features/hardware/camera-barcode-scanner.tsx");
  const pos = read("apps/mobile/app/(app)/pos.tsx");
  assert.match(camera, /createBarcodeScanGuard/);
  assert.match(camera, /if \(!value \|\| !scanGuard\.tryAcquire\(\)\) return/);
  assert.match(camera, /Enter code manually/);
  assert.match(pos, /hidLookupGuard\.tryAcquire\(\)/);
  assert.match(pos, /setCameraScannerOpen\(false\)/);
});
