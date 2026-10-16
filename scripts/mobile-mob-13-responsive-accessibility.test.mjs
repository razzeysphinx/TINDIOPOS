import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("Slice 13 defines four responsive classes and large-text-safe layout decisions", () => {
  const responsive = read("apps/mobile/src/ui/tindio-responsive.ts");
  const home = read("apps/mobile/app/(app)/index.tsx");
  const pos = read("apps/mobile/app/(app)/pos.tsx");
  const catalogue = read("apps/mobile/src/features/cashier/cashier-catalogue.tsx");
  const config = JSON.parse(read("apps/mobile/app.json"));

  for (const size of ["compact-phone", "standard-phone", "compact-tablet", "tablet"]) {
    assert.match(responsive, new RegExp(`"${size}"`));
  }
  assert.match(responsive, /TINDIO_LARGE_TEXT_MIN_SCALE = 1\.3/);
  assert.match(responsive, /allowsColumns: width >= 720 && !isLargeText/);
  assert.match(responsive, /allowsDenseGrid: width >= 600 && !isLargeText/);
  assert.match(home, /useTindioResponsiveLayout/);
  assert.match(pos, /usesTabletCartPane = allowsColumns && viewportClass === "tablet"/);
  assert.match(catalogue, /numberOfLines=\{largeText \? undefined : 2\}/);
  assert.equal(config.expo.orientation, "default");
});

test("Slice 13 keeps scrollable work keyboard-visible at every viewport", () => {
  const screen = read("apps/mobile/src/ui/tindio-screen.tsx");
  const pos = read("apps/mobile/app/(app)/pos.tsx");
  const signIn = read("apps/mobile/app/sign-in.tsx");
  const sync = read("apps/mobile/app/(app)/sync-status.tsx");

  assert.match(screen, /automaticallyAdjustKeyboardInsets/);
  assert.match(screen, /keyboardDismissMode="on-drag"/);
  assert.match(screen, /keyboardShouldPersistTaps="handled"/);
  assert.match(pos, /<KeyboardAvoidingView[\s\S]*automaticallyAdjustKeyboardInsets/);
  assert.match(signIn, /<KeyboardAvoidingView[\s\S]*automaticallyAdjustKeyboardInsets/);
  assert.match(sync, /<TindioScreen[\s\S]*scroll testID="sync-status-scroll"/);
});

test("Slice 13 exposes TalkBack semantics, live announcements, and reduced-motion preferences", () => {
  const provider = read("apps/mobile/src/ui/tindio-accessibility.tsx");
  const feedback = read("apps/mobile/src/ui/tindio-feedback.tsx");
  const button = read("apps/mobile/src/ui/tindio-button.tsx");
  const card = read("apps/mobile/src/ui/tindio-card.tsx");
  const progress = read("apps/mobile/src/ui/tindio-progress-indicator.tsx");
  const workspace = read("apps/mobile/src/ui/tindio-workspace.tsx");

  assert.match(provider, /AccessibilityInfo\.isReduceMotionEnabled/);
  assert.match(provider, /"reduceMotionChanged"/);
  assert.match(provider, /AccessibilityInfo\.isScreenReaderEnabled/);
  assert.match(provider, /"screenReaderChanged"/);
  assert.match(feedback, /accessibilityLiveRegion=\{isAlert \? "assertive" : "polite"\}/);
  assert.match(feedback, /!reduceMotionEnabled/);
  assert.match(button, /accessibilityState=\{\{ \.\.\.accessibilityState, busy, disabled: unavailable \}\}/);
  assert.match(button, /!reduceMotionEnabled/);
  assert.match(progress, /reduceMotionEnabled[\s\S]*<Text style=\{styles\.label\}>\{label\}<\/Text>/);
  assert.match(card, /accessibilityRole="header"/);
  assert.match(workspace, /accessibilityState=\{\{ disabled: Boolean\(disabled\), selected \}\}/);
});

test("Slice 13 groups recovery diagnostics and preserves minimum targets", () => {
  const sync = read("apps/mobile/app/(app)/sync-status.tsx");
  for (const group of [
    "Device and offline preparation",
    "Local catalogue",
    "Durable transaction queue",
    "Supervised transaction recovery",
    "Device sequence and cloud reconciliation",
    "Connection modes",
    "Inventory and performance",
  ]) assert.match(sync, new RegExp(group));
  assert.match(sync, /action: \{[^}]*minHeight: tindioTheme\.target\.minimum/);
  assert.match(sync, /input: \{[^}]*minHeight: tindioTheme\.target\.minimum/);
  assert.match(sync, /testID="sync-durable-outbox"/);
  assert.match(sync, /testID="refresh-server-checkpoint"/);
});

test("Slice 13 records deterministic development baseline states without claiming physical proof", () => {
  const baseline = JSON.parse(read("apps/mobile/evidence/mob-13-slice-13-baselines.json"));
  assert.equal(baseline.certificationEvidence, false);
  assert.equal(baseline.browserCaptureStatus, "BLOCKED");
  assert.equal(baseline.physicalRuntimeStatus, "NOT_RUN");
  assert.deepEqual(
    baseline.states.map((state) => state.id),
    [
      "compact-phone-portrait",
      "standard-phone-portrait",
      "standard-phone-keyboard",
      "standard-phone-large-text",
      "compact-tablet-portrait",
      "tablet-landscape",
    ],
  );
});

test("Slice 13 does not add transaction reset or custody deletion paths", () => {
  for (const path of [
    "apps/mobile/app/(app)/pos.tsx",
    "apps/mobile/app/(app)/sync-status.tsx",
    "apps/mobile/src/ui/tindio-responsive.ts",
    "apps/mobile/src/ui/tindio-accessibility.tsx",
  ]) {
    assert.doesNotMatch(read(path), /DELETE FROM|DROP TABLE|clearDatabase|resetDatabase/);
  }
});
