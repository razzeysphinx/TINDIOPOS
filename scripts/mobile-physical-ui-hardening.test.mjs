import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("A49 POS keeps checkout controls scrollable with a resizing keyboard and large text", () => {
  const pos = read("apps/mobile/app/(app)/pos.tsx");
  const config = JSON.parse(read("apps/mobile/app.json"));

  assert.equal(config.expo.android.softwareKeyboardLayoutMode, "resize");
  assert.match(pos, /<KeyboardAvoidingView[\s\S]*style=\{\{ flex: 1 \}\}/);
  assert.match(pos, /behavior=\{Platform\.OS === "ios" \? "padding" : "height"\}/);
  assert.match(pos, /automaticallyAdjustKeyboardInsets/);
  assert.match(pos, /keyboardDismissMode="on-drag"/);
  assert.match(pos, /keyboardShouldPersistTaps="handled"/);
  assert.match(pos, /testID="checkout-panel"/);
  assert.match(pos, /testID="cash-tender-input"/);
  assert.match(pos, /testID="save-offline-cash-sale"/);
  assert.match(pos, /testID="complete-online-cash-checkout"/);

  const scrollStart = pos.indexOf("<ScrollView");
  const scrollEnd = pos.lastIndexOf("</ScrollView>");
  const checkoutPanel = pos.indexOf('testID="checkout-panel"');
  const tender = pos.indexOf('testID="cash-tender-input"');
  assert.ok(
    scrollStart >= 0
      && checkoutPanel > scrollStart
      && tender > checkoutPanel
      && scrollEnd > tender,
    "tender and checkout actions must remain inside the scrollable keyboard-aware surface",
  );
  assert.match(pos, /accessibilityLabel="Cash tendered"[\s\S]*?style=\{\{ minHeight: 48 \}\}[\s\S]*?testID="cash-tender-input"/);
  assert.match(pos, /testID="save-offline-cash-sale"[\s\S]*?style=\{\{ minHeight: 48, justifyContent: "center" \}\}/);
  assert.match(pos, /testID="complete-online-cash-checkout"[\s\S]*?style=\{\{ minHeight: 48, justifyContent: "center" \}\}/);
});

test("A49 sign-in and cashier editors remain reachable with keyboard and enlarged text", () => {
  const signIn = read("apps/mobile/app/sign-in.tsx");
  const editors = read("apps/mobile/src/features/cashier/cashier-editors.tsx");
  const cartLine = read("apps/mobile/src/features/cashier/cashier-cart-line.tsx");

  assert.match(signIn, /<KeyboardAvoidingView[\s\S]*<ScrollView/);
  assert.match(signIn, /automaticallyAdjustKeyboardInsets/);
  assert.match(signIn, /testID="sign-in-scroll"/);
  assert.match(signIn, /accessibilityLabel="Employee email"/);
  assert.match(signIn, /accessibilityLabel="Employee password"/);
  assert.match(signIn, /accessibilityLabel="Sign in"[\s\S]*accessibilityRole="button"/);
  assert.match(editors, /testID="variable-price-scroll"/);
  assert.match(editors, /testID="modifier-picker-scroll"/);
  assert.match(editors, /accessibilityRole="checkbox"/);
  assert.match(editors, /accessibilityState=\{\{ checked: isSelected \}\}/);
  assert.match(cartLine, /accessibilityLabel=\{`\$\{line\.productName\} quantity`\}/);
  assert.match(cartLine, /accessibilityLabel=\{`Remove \$\{line\.productName\}`\}/);
});

test("A49 Android routes honor system safe areas", () => {
  const rootLayout = read("apps/mobile/app/_layout.tsx");
  const appLayout = read("apps/mobile/app/(app)/_layout.tsx");
  const signIn = read("apps/mobile/app/sign-in.tsx");

  assert.match(rootLayout, /<SafeAreaProvider>/);
  assert.match(appLayout, /<SafeAreaView edges=\{\["top", "bottom"\]\} style=\{\{ flex: 1 \}\}>/);
  assert.match(signIn, /<SafeAreaView edges=\{\["top", "bottom"\]\} style=\{\{ flex: 1 \}\}>/);
});

test("MOB-10 Sync Status scrolls and refreshes database-backed diagnostics on focus", () => {
  const sync = read("apps/mobile/app/(app)/sync-status.tsx");

  assert.match(sync, /useFocusEffect\(useCallback\(\(\) => \{/);
  assert.match(sync, /if \(active\) void load\(\)/);
  assert.match(sync, /<ScrollView[\s\S]*testID="sync-status-scroll"/);
  assert.match(sync, /testID="recheck-backend"/);
  assert.match(sync, /testID="sync-durable-outbox"/);
  assert.match(sync, /testID="refresh-server-checkpoint"/);
  const recheck = sync.slice(
    sync.indexOf("const recheck = useCallback"),
    sync.indexOf("const prepare = useCallback"),
  );
  assert.ok(recheck.indexOf("await reload(organizationId)") < recheck.indexOf("await load()"));
});

test("MOB-10 Receipts refreshes saved device records whenever the screen regains focus", () => {
  const receipts = read("apps/mobile/app/(app)/receipts.tsx");

  assert.match(receipts, /useFocusEffect\(useCallback\(\(\) => \{/);
  assert.match(receipts, /void load\(queryRef\.current\)/);
  assert.match(receipts, /const localPromise = searchLocalReceipts/);
  assert.match(receipts, /const serverPromise = fetchPosV2Receipts/);
  assert.ok(
    receipts.indexOf("setLocalRows(local)") < receipts.indexOf("await serverPromise"),
    "saved device receipts must render even if the online receipt request later fails",
  );
  assert.match(receipts, /<ScrollView[\s\S]*testID="receipts-scroll"/);
  assert.match(receipts, /accessibilityLiveRegion="polite"/);
});

test("MOB-10 UI hardening does not add transaction reset or custody deletion paths", () => {
  for (const path of [
    "apps/mobile/app/sign-in.tsx",
    "apps/mobile/app/(app)/pos.tsx",
    "apps/mobile/src/features/cashier/cashier-cart-line.tsx",
    "apps/mobile/src/features/cashier/cashier-editors.tsx",
    "apps/mobile/app/(app)/sync-status.tsx",
    "apps/mobile/app/(app)/receipts.tsx",
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /DELETE FROM|DROP TABLE|clearDatabase|resetDatabase/);
  }
});
