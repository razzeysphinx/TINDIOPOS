import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("shared contract is framework-neutral and complete", async () => {
  const [source, facade] = await Promise.all([
    read("packages/contracts/src/ui.ts"),
    read("src/contracts/ui/tindio-design-tokens.ts"),
  ]);
  assert.doesNotMatch(source, /from ["'](?:react|react-native|expo|next|node:)/);
  for (const token of ["brand", "surface", "content", "border", "status", "typography", "space", "radius", "elevation", "icon", "target", "motion"]) {
    assert.match(source, new RegExp(`${token}:`));
  }
  for (const status of ["success", "warning", "danger", "information", "recovering", "review"]) {
    assert.match(source, new RegExp(`${status}:`));
  }
  assert.match(source, /brandApproval: "candidate"/);
  assert.match(facade, /from ["']@tindio\/contracts\/ui["']/);
});

test("web variables adapt the shared semantic vocabulary", async () => {
  const css = await read("src/app/globals.css");
  for (const variable of ["--tindio-brand-primary", "--tindio-surface-app", "--tindio-content-primary", "--tindio-border-focus", "--tindio-status-recovering", "--tindio-status-review", "--tindio-target-minimum"]) {
    assert.match(css, new RegExp(variable));
  }
});

test("native primitives preserve accessibility and touch target contracts", async () => {
  const [button, input, badge, feedback, screen] = await Promise.all([
    read("apps/mobile/src/ui/tindio-button.tsx"),
    read("apps/mobile/src/ui/tindio-input.tsx"),
    read("apps/mobile/src/ui/tindio-status-badge.tsx"),
    read("apps/mobile/src/ui/tindio-feedback.tsx"),
    read("apps/mobile/src/ui/tindio-screen.tsx"),
  ]);
  assert.match(button, /accessibilityRole="button"/);
  assert.match(button, /accessibilityState=\{\{ \.\.\.accessibilityState, busy, disabled: unavailable \}\}/);
  assert.match(button, /minHeight: tindioTheme\.target\.minimum/);
  assert.match(input, /accessibilityLabel=\{accessibilityLabel \?\? label\}/);
  assert.match(input, /minHeight: tindioTheme\.target\.minimum/);
  assert.match(badge, /TindioStatusTone/);
  assert.match(feedback, /accessibilityRole=\{isAlert \? "alert" : undefined\}/);
  assert.match(screen, /keyboardShouldPersistTaps="handled"/);
});

test("Slice 07 does not alter the checkout route", async () => {
  const report = await read("docs/mobile-program/MOB_13_SLICE_06_UI_CONTRACT_SCREEN_INVENTORY.md");
  assert.match(report, /must not add a dependency or modify `pos\.tsx` in Slice 07/);
});
