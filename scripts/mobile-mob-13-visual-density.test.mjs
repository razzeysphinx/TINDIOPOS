import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("Slice 16 activates the persistent cart at the documented 720px split threshold", () => {
  const pos = read("apps/mobile/app/(app)/pos.tsx");
  const responsive = read("apps/mobile/src/ui/tindio-responsive.ts");

  assert.match(responsive, /allowsColumns: width >= 720 && !isLargeText/);
  assert.match(pos, /usesTabletCartPane = allowsColumns/);
  assert.doesNotMatch(pos, /allowsColumns && viewportClass === "tablet"/);
  assert.match(pos, /compact=\{!usesTabletCartPane\}/);
  assert.match(pos, /expanded=\{usesTabletCartPane \|\| cartExpanded\}/);
});

test("Slice 16 applies compact density without reducing touch targets", () => {
  const pos = read("apps/mobile/app/(app)/pos.tsx");
  const frame = read("apps/mobile/src/features/cashier/cashier-pos-frame.tsx");
  const cart = read("apps/mobile/src/features/cashier/cashier-cart-workspace.tsx");
  const button = read("apps/mobile/src/ui/tindio-button.tsx");

  assert.match(pos, /usesCompactPhoneSpacing/);
  assert.match(pos, /scrollContentCompact/);
  assert.match(frame, /headerCompact/);
  assert.match(frame, /gatePhone/);
  assert.match(cart, /panelCompact/);
  assert.match(button, /minHeight: tindioTheme\.target\.minimum/);
});

test("Slice 16 records the required phone and tablet layout matrix honestly", () => {
  const evidence = JSON.parse(read("apps/mobile/evidence/mob-13-slice-16-layout-matrix.json"));

  assert.equal(evidence.certificationEvidence, false);
  assert.equal(evidence.physicalCaptureStatus, "NOT_RUN");
  assert.deepEqual(
    evidence.states.map(({ id, workspace }) => [id, workspace]),
    [
      ["compact-phone-portrait", "stacked"],
      ["standard-phone-portrait", "stacked"],
      ["compact-tablet-portrait", "split"],
      ["tablet-landscape", "split"],
      ["tablet-large-text", "stacked"],
    ],
  );
});

test("Slice 16 remains presentation-only", () => {
  const source = [
    "apps/mobile/src/features/cashier/cashier-pos-frame.tsx",
    "apps/mobile/src/features/cashier/cashier-cart-workspace.tsx",
  ].map(read).join("\n");

  assert.doesNotMatch(source, /checkoutPosV2|createOfflineCashSale|syncOutboxEvents|DELETE FROM|DROP TABLE/);
});
