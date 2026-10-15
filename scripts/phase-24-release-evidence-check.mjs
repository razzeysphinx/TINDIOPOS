import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const evidencePath =
  "docs/mobile-program/evidence/PHASE_24_GOOGLE_PLAY_RELEASE_EVIDENCE.json";

const evidence =
  JSON.parse(
    fs.readFileSync(
      evidencePath,
      "utf8",
    ),
  );

const scenarioNames = [
  "loginAndBusinessContext",
  "deviceEnrollment",
  "storeRegisterAssignment",
  "initialSync",
  "onlineCashSale",
  "offlineCashSale",
  "appKillRecovery",
  "phoneRestartRecovery",
  "networkLossBeforeCommit",
  "networkLossAfterCommit",
  "missingAckReplay",
  "reconnectExactlyOnce",
  "cameraBarcode",
  "hidBarcode",
  "tenantIsolation",
  "storeIsolation",
  "revokedDevice",
  "closedShift",
  "upgradeWithUnsyncedEvent",
  "noDuplicateMoney",
  "noDuplicateInventoryMovement",
];

test(
  "Phase 24 release evidence schema is complete",
  () => {
    assert.equal(
      evidence.phase,
      24,
    );

    assert.equal(
      evidence.packageId,
      "com.tindio.pos",
    );

    assert.equal(evidence.reviewerAccess.credentialSource, "PLAY_CONSOLE_ONLY");
    assert.equal(evidence.reviewerAccess.tenantType, "SYNTHETIC_STAGING");
    assert.equal(evidence.reviewerAccess.containsProductionMerchantData, false);
    assert.equal(evidence.reviewerAccess.freshInstallSelfEnrollmentRequired, true);
    assert.equal(
      evidence.reviewerAccess.instructionsPath,
      "docs/mobile-program/GOOGLE_PLAY_REVIEWER_ACCESS.md",
    );
    assert.equal(evidence.publicPolicyAccess.accountDeletionApplicable, true);
    assert.equal(evidence.publicPolicyAccess.privacyPath, "/privacy");
    assert.equal(evidence.publicPolicyAccess.supportPath, "/support");
    assert.equal(evidence.publicPolicyAccess.accountDeletionPath, "/account-deletion");

    for (const permission of [
      "devices.manage",
      "pos.access",
      "sales.create",
      "payments.accept",
      "receipts.view",
      "receipts.reprint",
      "shifts.open",
      "shifts.close",
    ]) {
      assert.ok(
        evidence.reviewerAccess.requiredPermissions.includes(permission),
        `reviewer access is missing ${permission}`,
      );
    }

    for (
      const key
      of scenarioNames
    ) {
      assert.ok(
        key
        in evidence.realStoreScenarios,
        `missing scenario ${key}`,
      );
    }
  },
);

test(
  "production cannot be eligible before the entire release ladder passes",
  () => {
    const ladderPassed =
      evidence.reviewerAccess.status
        === "PASS"
      && evidence.publicPolicyAccess.status
        === "PASS"
      && evidence.signedAab.status
        === "PASS"
      && evidence.developmentDevice.status
        === "PASS"
      && evidence.internalTesting.status
        === "PASS"
      && evidence.closedTesting.status
        === "PASS"
      && evidence.pilotMerchants.status
        === "PASS"
      && scenarioNames.every(
        (key) =>
          evidence
            .realStoreScenarios[
              key
            ] === "PASS",
      );

    if (!ladderPassed) {
      assert.equal(
        evidence.production.eligible,
        false,
      );

      assert.equal(
        evidence.production.releaseStatus,
        "BLOCKED",
      );
    }
  },
);
