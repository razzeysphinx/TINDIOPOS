import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("shared POS item identity retains ticket and saleable-line semantics", async () => {
  const contract = await read("packages/contracts/src/cart.ts");

  assert.match(contract, /export function posItemKey/);
  assert.match(contract, /if \(item\.ticketLineId\) return `ticket:\$\{item\.ticketLineId\}`/);
  assert.match(contract, /item\.productId/);
  assert.match(contract, /item\.variantId \?\? "simple"/);
  assert.match(contract, /item\.manualPriceMinor \?\? "catalog"/);
  assert.match(contract, /\[\.\.\.\(item\.modifierOptionIds \?\? \[\]\)\]\.sort\(\)\.join\(","\)/);
  assert.match(contract, /item\.itemNote \?\? ""/);
});

test("shared TINDIO tokens retain the approved candidate contract", async () => {
  const contract = await read("packages/contracts/src/ui.ts");

  assert.match(contract, /version:\s*1/);
  assert.match(contract, /brandApproval:\s*"candidate"/);
  assert.match(contract, /primary:\s*"#007A67"/);
  assert.match(contract, /minimum:\s*48/);
  for (const tone of [
    "success",
    "warning",
    "danger",
    "information",
    "recovering",
    "review",
  ]) {
    assert.match(contract, new RegExp(`\\b${tone}:`));
  }
  assert.match(contract, /export type TindioStatusTone/);
  assert.doesNotMatch(
    contract,
    /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/,
  );
});

test("Web helper and token paths remain compatibility facades", async () => {
  const [posTypes, uiTokens] = await Promise.all([
    read("src/features/pos/pos-types.ts"),
    read("src/contracts/ui/tindio-design-tokens.ts"),
  ]);

  assert.match(posTypes, /export \{ posItemKey \} from ["']@tindio\/contracts\/cart["']/);
  assert.doesNotMatch(posTypes, /export function posItemKey/);
  assert.match(uiTokens, /export \{ tindioDesignTokens \} from ["']@tindio\/contracts\/ui["']/);
  assert.match(uiTokens, /export type \{ TindioStatusTone \} from ["']@tindio\/contracts\/ui["']/);
  assert.doesNotMatch(uiTokens, /brandApproval|export const tindioDesignTokens/);
});

test("Mobile helper and token consumers use only the shared package", async () => {
  const paths = [
    "apps/mobile/app/(app)/pos.tsx",
    "apps/mobile/src/features/cashier/cashier-cart-workspace.tsx",
    "apps/mobile/src/ui/theme.ts",
    "apps/mobile/src/ui/tindio-feedback.tsx",
    "apps/mobile/src/ui/tindio-status-badge.tsx",
  ];
  const sources = await Promise.all(paths.map(read));

  for (const source of sources) {
    assert.match(source, /from ["']@tindio\/contracts\/(?:cart|ui)["']/);
    assert.doesNotMatch(
      source,
      /src\/features\/pos\/pos-types|src\/contracts\/ui\/tindio-design-tokens/,
    );
  }
});
