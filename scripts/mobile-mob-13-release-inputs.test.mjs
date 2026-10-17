import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  auditProductionReleaseReadiness,
  assertProductionReleaseInputs,
  productionOrigin,
} = require("../apps/mobile/release-inputs.js");

const blockedManifest = JSON.parse(
  fs.readFileSync("apps/mobile/production-release.json", "utf8"),
);

const readyManifest = {
  ...blockedManifest,
  status: "READY",
  eas: {
    owner: "tindio-release",
    projectId: "53b9f9a6-8194-4a7e-8600-1373b84f4c90",
  },
  endpoints: {
    tindioApiOrigin: "https://pos.tindio.com",
    supabaseAuthOrigin: "https://auth.tindio.com",
  },
  signing: {
    credentialsSource: "remote",
    status: "VERIFIED",
    verifiedAt: "2026-10-15T00:00:00.000Z",
  },
  branding: {
    status: "APPROVED",
    appIcon: "assets/branding/tindio-icon-candidate-1024.png",
    adaptiveForeground: "assets/branding/tindio-mark-candidate-1024.png",
    splash: "assets/branding/tindio-mark-candidate-1024.png",
  },
  storeListing: {
    status: "READY",
    featureGraphic: "assets/play/feature-graphic-candidate-1024x500.png",
    phoneScreenshots: ["assets/branding/tindio-icon-candidate-1024.png"],
    sevenInchTabletScreenshots: [],
    tenInchTabletScreenshots: [],
    shortDescription: "Approved description",
    fullDescription: "Approved full description",
    supportEmail: "support@tindio.com",
  },
};

const readyEnvironment = {
  EXPO_PUBLIC_TINDIO_API_URL: "https://pos.tindio.com",
  EXPO_PUBLIC_SUPABASE_URL: "https://auth.tindio.com",
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_release_contract_value",
};

test("MOB-13 blocks production while release inputs are unapproved", () => {
  assert.equal(blockedManifest.status, "BLOCKED");
  assert.throws(
    () => assertProductionReleaseInputs(blockedManifest, readyEnvironment),
    /MOB-13_PRODUCTION_RELEASE_BLOCKED/,
  );

  const configureApp = require("../apps/mobile/app.config.js");
  const previous = process.env.EAS_BUILD_PROFILE;
  process.env.EAS_BUILD_PROFILE = "production";
  try {
    assert.throws(
      () => configureApp({ config: { plugins: [] } }),
      /MOB-13_PRODUCTION_RELEASE_BLOCKED/,
    );
  } finally {
    if (previous === undefined) delete process.env.EAS_BUILD_PROFILE;
    else process.env.EAS_BUILD_PROFILE = previous;
  }
});

test("MOB-13 validates exact EAS identity and embedded production origins", () => {
  assert.deepEqual(
    assertProductionReleaseInputs(readyManifest, readyEnvironment),
    {
      owner: "tindio-release",
      projectId: "53b9f9a6-8194-4a7e-8600-1373b84f4c90",
    },
  );

  assert.throws(
    () => assertProductionReleaseInputs(readyManifest, {
      ...readyEnvironment,
      EXPO_PUBLIC_TINDIO_API_URL: "https://wrong.tindio.com",
    }),
    /does not match the approved release manifest/,
  );
});

test("MOB-13 rejects local, insecure, credentialed, and placeholder origins", () => {
  for (const value of [
    "http://pos.tindio.com",
    "https://localhost",
    "https://intranet",
    "https://127.0.0.1",
    "https://pos.tindio.test",
    "https://YOUR-TINDIO-BACKEND.example.com",
    "https://user:password@pos.tindio.com",
    "https://pos.tindio.com/api",
    "https://pos.tindio.com?preview=true",
  ]) {
    assert.throws(() => productionOrigin(value, "testOrigin"));
  }
});

test("MOB-13 inventory truthfully records missing branding and Play assets", () => {
  assert.equal(blockedManifest.branding.status, "CANDIDATE_REVIEW_REQUIRED");
  assert.equal(blockedManifest.storeListing.status, "CANDIDATE_REVIEW_REQUIRED");
  assert.equal(
    blockedManifest.storeListing.featureGraphic,
    "assets/play/feature-graphic-candidate-1024x500.png",
  );
  assert.deepEqual(blockedManifest.storeListing.phoneScreenshots, []);
  assert.equal(blockedManifest.publicPolicyEvidencePath,
    "docs/mobile-program/evidence/PHASE_24_GOOGLE_PLAY_RELEASE_EVIDENCE.json");
});

function pngDimensions(file) {
  const png = fs.readFileSync(file);
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

test("MOB-13 candidate artwork replaces Expo templates at exact export sizes", () => {
  const app = JSON.parse(fs.readFileSync("apps/mobile/app.json", "utf8")).expo;
  const splash = app.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "expo-splash-screen",
  )?.[1];
  assert.equal(app.icon, "./assets/branding/tindio-icon-candidate-1024.png");
  assert.equal(
    app.android.adaptiveIcon.foregroundImage,
    "./assets/branding/tindio-mark-candidate-1024.png",
  );
  assert.equal(app.android.adaptiveIcon.backgroundColor, "#F4EFE5");
  assert.equal(app.android.adaptiveIcon.backgroundImage, undefined);
  assert.equal(app.android.adaptiveIcon.monochromeImage, undefined);
  assert.equal(app.web.favicon, app.icon);
  assert.deepEqual(splash?.dark, {
    backgroundColor: "#F4EFE5",
    image: "./assets/branding/tindio-mark-candidate-1024.png",
  });
  assert.deepEqual(
    pngDimensions("apps/mobile/assets/branding/tindio-icon-candidate-1024.png"),
    { width: 1024, height: 1024 },
  );
  assert.deepEqual(
    pngDimensions("apps/mobile/assets/branding/tindio-mark-candidate-1024.png"),
    { width: 1024, height: 1024 },
  );
  assert.deepEqual(
    pngDimensions("apps/mobile/assets/play/feature-graphic-candidate-1024x500.png"),
    { width: 1024, height: 500 },
  );
});

test("MOB-13 listing copy is accurate and real screenshots remain required", () => {
  const listing = blockedManifest.storeListing;
  assert.ok(listing.shortDescription.length <= 80);
  assert.match(listing.fullDescription, /supported cash sales/);
  assert.match(listing.fullDescription, /Electronic and card payments remain unavailable offline/);
  assert.match(listing.fullDescription, /not supported in the v1 Android release/);
  assert.deepEqual(listing.phoneScreenshots, []);
  assert.equal(listing.supportEmail, null);
});

test("MOB-13 requires referenced Play listing assets to exist", () => {
  assert.throws(
    () => assertProductionReleaseInputs({
      ...readyManifest,
      storeListing: {
        ...readyManifest.storeListing,
        featureGraphic: "assets/play/missing-feature-graphic.png",
      },
    }, readyEnvironment),
    /Google Play listing asset is missing/,
  );
});

test("MOB-13 readiness audit reports every current blocker without secret values", () => {
  const report = auditProductionReleaseReadiness(blockedManifest, {});

  assert.equal(report.status, "BLOCKED");
  assert.deepEqual(report.blocked, [
    "manifest_status",
    "eas_identity",
    "production_api_origin",
    "supabase_auth_origin",
    "supabase_publishable_key",
    "remote_signing",
    "branding_approval",
    "listing_approval",
    "support_email",
    "phone_screenshots",
  ]);
  assert.equal(report.checks.length, 15);
  assert.doesNotMatch(JSON.stringify(report), /sb_publishable/u);
});

test("MOB-13 readiness audit becomes ready only with complete approved inputs", () => {
  const report = auditProductionReleaseReadiness(
    readyManifest,
    readyEnvironment,
  );

  assert.equal(report.status, "READY");
  assert.deepEqual(report.blocked, []);
  assert.ok(report.checks.every((check) => check.status === "PASS"));
});

test("MOB-13 audit and validator reject invalid listing limits and optional asset paths", () => {
  const overlong = {
    ...readyManifest,
    storeListing: {
      ...readyManifest.storeListing,
      shortDescription: "x".repeat(81),
    },
  };
  assert.throws(
    () => assertProductionReleaseInputs(overlong, readyEnvironment),
    /Google Play listing inputs are incomplete/,
  );

  const missingTablet = {
    ...readyManifest,
    storeListing: {
      ...readyManifest.storeListing,
      sevenInchTabletScreenshots: ["assets/play/missing-tablet.png"],
    },
  };
  const report = auditProductionReleaseReadiness(
    missingTablet,
    readyEnvironment,
  );
  assert.deepEqual(report.blocked, ["tablet_screenshot_paths"]);
});
