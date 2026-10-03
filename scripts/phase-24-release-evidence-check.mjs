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
      evidence.signedAab.status
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
