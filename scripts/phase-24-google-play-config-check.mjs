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
