import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) =>
  fs.readFileSync(
    path,
    "utf8",
  );

test(
  "Phase 24 Google Play release ladder is configured safely",
  () => {
    const eas =
      JSON.parse(
        read(
          "apps/mobile/eas.json",
        ),
      );

    const app =
      JSON.parse(
        read(
          "apps/mobile/app.json",
        ),
      ).expo;

    assert.equal(
      app.android.package,
      "com.tindio.pos",
    );

    assert.equal(
      eas.build.production
        .android.buildType,
      "app-bundle",
    );

    assert.equal(
      eas.build.production
        .android.credentialsSource,
      "remote",
    );

    assert.equal(
      eas.submit.internal
        .android.track,
      "internal",
    );

    assert.equal(
      eas.submit.internal
        .android.releaseStatus,
      "completed",
    );

    assert.equal(
      eas.submit.closed
        .android.track,
      "alpha",
    );

    assert.equal(
      eas.submit.pilot
        .android.track,
      "alpha",
    );

    assert.equal(
      eas.submit.production
        .android.track,
      "production",
    );

    assert.equal(
      eas.submit.production
        .android.releaseStatus,
      "draft",
      "Phase 24 repository config must not automatically globally release production",
    );
  },
);

test(
  "Phase 24 repository contains no committed Play service-account key",
  () => {
    const packageJson =
      read(
        "package.json",
      );

    const eas =
      read(
        "apps/mobile/eas.json",
      );

    assert.doesNotMatch(
      eas,
      /serviceAccountKeyPath|private_key|client_email/i,
      "Google service-account credentials must remain outside Git",
    );

    assert.doesNotMatch(
      packageJson,
      /serviceAccountKeyPath/i,
    );
  },
);

test(
  "A46 reviewer access contract is self-enrolling, synthetic, and secret-safe",
  () => {
    const evidence = JSON.parse(read(
      "docs/mobile-program/evidence/PHASE_24_GOOGLE_PLAY_RELEASE_EVIDENCE.json",
    ));
    const instructions = read(evidence.reviewerAccess.instructionsPath);
    const mobileHome = read("apps/mobile/app/(app)/index.tsx");
    const deviceSetup = read("apps/mobile/src/features/device/device-setup.tsx");

    assert.equal(evidence.reviewerAccess.credentialSource, "PLAY_CONSOLE_ONLY");
    assert.equal(evidence.reviewerAccess.containsProductionMerchantData, false);
    assert.equal(evidence.reviewerAccess.freshInstallSelfEnrollmentRequired, true);
    assert.match(deviceSetup, /permissions\.includes\("devices\.manage"\)/);
    assert.match(instructions, /TINDIO_PLAY_REVIEWER_EMAIL/);
    assert.match(instructions, /TINDIO_PLAY_REVIEWER_PASSWORD/);
    assert.match(instructions, /Electronic\/card payment while offline is intentionally unavailable/);
    assert.match(instructions, /manual barcode\/SKU entry remains available/);

    for (const route of [
      "pos",
      "receipts",
      "shift",
      "sync-status",
      "hardware",
      "offline-payments",
      "production-readiness",
      "settings",
      "customers",
      "tickets",
      "transfers",
      "time-clock",
    ]) {
      assert.match(mobileHome, new RegExp(`/${route}`), `mobile route ${route} is not declared`);
      assert.match(instructions, new RegExp(`\\*\\*${route}\\*\\*`), `reviewer instructions omit ${route}`);
    }

    const serializedEvidence = JSON.stringify(evidence);
    assert.doesNotMatch(serializedEvidence, /@/u, "reviewer email must not be committed");
    assert.doesNotMatch(serializedEvidence, /"password"\s*:/iu, "reviewer password must not be committed");
  },
);
