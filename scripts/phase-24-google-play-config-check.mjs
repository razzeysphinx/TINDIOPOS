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
    const mobileNavigation = read(
      "apps/mobile/src/features/cashier/cashier-navigation.ts",
    );
    const declaredMobileRoutes = mobileHome + mobileNavigation;
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
      assert.match(declaredMobileRoutes, new RegExp(`/${route}`), `mobile route ${route} is not declared`);
      assert.match(instructions, new RegExp(`\\*\\*${route}\\*\\*`), `reviewer instructions omit ${route}`);
    }

    const serializedEvidence = JSON.stringify(evidence);
    assert.doesNotMatch(serializedEvidence, /@/u, "reviewer email must not be committed");
    assert.doesNotMatch(serializedEvidence, /"password"\s*:/iu, "reviewer password must not be committed");
  },
);

test(
  "A47 public policy routes are discoverable, accurate about retention, and fail closed",
  () => {
    const evidence = JSON.parse(read(
      "docs/mobile-program/evidence/PHASE_24_GOOGLE_PLAY_RELEASE_EVIDENCE.json",
    ));
    const privacy = read("src/app/privacy/page.tsx");
    const support = read("src/app/support/page.tsx");
    const deletion = read("src/app/account-deletion/page.tsx");
    const signup = read("src/app/(auth)/signup/page.tsx");
    const mobileLinks = read("apps/mobile/src/features/support/public-policy-links.tsx");
    const signedOut = read("apps/mobile/app/sign-in.tsx");
    const signedIn = read("apps/mobile/app/(app)/settings.tsx");

    assert.equal(evidence.publicPolicyAccess.accountDeletionApplicable, true);
    assert.ok(["NOT_RUN", "BLOCKED", "FAIL", "PASS"].includes(evidence.publicPolicyAccess.status));
    if (evidence.publicPolicyAccess.status === "PASS") {
      for (const key of [
        "responsibleEntity",
        "privacyContact",
        "supportOwner",
        "effectiveDate",
        "publicHttpsOrigin",
        "publicUrlsVerifiedAt",
        "inAppLinksVerifiedAt",
        "deletionRequestVerifiedAt",
        "playConsoleConfiguredAt",
      ]) {
        assert.ok(evidence.publicPolicyAccess[key]?.trim(), `A47 PASS requires ${key}`);
      }
      assert.match(evidence.publicPolicyAccess.publicHttpsOrigin, /^https:\/\//u);
    }
    assert.match(signup, /Create account/);
    assert.match(privacy, /Organization archival is not account deletion/);
    assert.match(privacy, /sales, payment, receipt, inventory, shift, approval, and audit records/);
    assert.match(deletion, /Temporary deactivation, suspension, or organization archival is not treated as completed account deletion/);
    assert.match(deletion, /Request intake is not yet production-ready/);
    assert.match(support, /Never uninstall the app, clear its storage, or delete pending transactions/);
    assert.match(mobileLinks, /mobileEnvironment\.tindioApiUrl/);

    for (const path of ["/privacy", "/support", "/account-deletion"]) {
      assert.match(mobileLinks, new RegExp(path));
    }
    assert.match(signedOut, /<PublicPolicyLinks \/>/);
    assert.match(signedIn, /<PublicPolicyLinks \/>/);
  },
);
