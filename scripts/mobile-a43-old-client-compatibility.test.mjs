import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

async function loadTypeScriptModule(file) {
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: file,
  }).outputText;

  return import(
    `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
  );
}

const legacyClose = {
  shiftId: "11111111-1111-4111-8111-111111111111",
  countedCash: "100.00",
  closingNote: "Audit-baseline client shape",
};

test("A43 audit-baseline shift close receives a safe upgrade decision", async () => {
  const compatibility = await loadTypeScriptModule(
    "src/features/shifts/mobile-shift-close-compatibility.ts",
  );
  const result = compatibility.legacyMobileShiftCloseUpgrade(
    legacyClose,
  );

  assert.deepEqual(result, {
    ok: false,
    code: "POS_CLIENT_UPGRADE_REQUIRED",
    requiredCapability: "SHIFT_CUSTODY_FINALIZATION_V1",
    retryable: false,
    preservesRecovery: true,
    message:
      "Update TINDIO POS before closing this shift. The shift remains open and pending transactions are preserved.",
  });
  assert.equal(
    compatibility.isMobileShiftCloseUpgradeRequired(result),
    true,
  );
});

test("A43 current and malformed partial close bodies do not impersonate the old client", async () => {
  const compatibility = await loadTypeScriptModule(
    "src/features/shifts/mobile-shift-close-compatibility.ts",
  );
  const device = {
    deviceId: "22222222-2222-4222-8222-222222222222",
    secret: "a".repeat(64),
    appVersion: "android-1.0.0",
  };

  assert.equal(
    compatibility.legacyMobileShiftCloseUpgrade({
      ...legacyClose,
      device,
      localHighWater: 17,
      finalizationToken:
        "33333333-3333-4333-8333-333333333333",
    }),
    null,
  );
  assert.equal(
    compatibility.legacyMobileShiftCloseUpgrade({
      ...legacyClose,
      device,
    }),
    null,
  );
  assert.equal(
    compatibility.legacyMobileShiftCloseUpgrade(null),
    null,
  );
});

test("A43 upgrade response occurs after permission checking and before mutation", () => {
  const service = readFileSync(
    "src/features/shifts/service.ts",
    "utf8",
  );
  const route = readFileSync(
    "src/app/api/pos/v2/shifts/close/route.ts",
    "utf8",
  );
  const permission = service.indexOf(
    'hasPermission(context, "shifts.close")',
  );
  const compatibility = service.indexOf(
    "legacyMobileShiftCloseUpgrade(input)",
  );
  const validation = service.indexOf(
    "mobileCloseShiftSchema.safeParse(input)",
  );
  const database = service.indexOf(
    "createBusinessContextClient(context",
    compatibility,
  );

  assert.ok(
    permission >= 0
      && permission < compatibility
      && compatibility < validation
      && validation < database,
  );
  assert.match(route, /isMobileShiftCloseUpgradeRequired\(result\)[\s\S]*\? 426/);
  assert.ok(
    route.indexOf("getPosV2BusinessContext(request)")
      < route.indexOf("closeMobileShift({"),
  );
});
