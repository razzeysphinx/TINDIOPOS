import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("MOB-10 POS keeps checkout controls reachable above a resizing keyboard", () => {
  const pos = read("apps/mobile/app/(app)/pos.tsx");
  const config = JSON.parse(read("apps/mobile/app.json"));

  assert.equal(config.expo.android.softwareKeyboardLayoutMode, "resize");
  assert.match(pos, /<KeyboardAvoidingView[\s\S]*style=\{\{ flex: 1 \}\}/);
  assert.match(pos, /keyboardDismissMode="on-drag"/);
  assert.match(pos, /keyboardShouldPersistTaps="handled"/);
  assert.match(pos, /testID="checkout-panel"/);
  assert.match(pos, /testID="cash-tender-input"/);
  assert.match(pos, /testID="save-offline-cash-sale"/);
  assert.match(pos, /testID="complete-online-cash-checkout"/);

  const scrollEnd = pos.indexOf("</ScrollView>");
  const checkoutPanel = pos.indexOf('testID="checkout-panel"');
  const tender = pos.indexOf('testID="cash-tender-input"');
  assert.ok(scrollEnd >= 0 && checkoutPanel > scrollEnd && tender > checkoutPanel);
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
    "apps/mobile/app/(app)/pos.tsx",
    "apps/mobile/app/(app)/sync-status.tsx",
    "apps/mobile/app/(app)/receipts.tsx",
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /DELETE FROM|DROP TABLE|clearDatabase|resetDatabase/);
  }
});
