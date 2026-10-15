/* eslint-disable @typescript-eslint/no-require-imports -- Expo loads this build-time validator through CommonJS app configuration. */
const { existsSync } = require("node:fs");
const { isIP } = require("node:net");
const path = require("node:path");

const PLACEHOLDER_PATTERN = /(?:^|[._-])(example|placeholder|todo)(?:[._-]|$)|YOUR-|CHANGE_ME|<[^>]+>/iu;
const EAS_PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EAS_OWNER_PATTERN = /^[a-z0-9][a-z0-9_-]{1,38}[a-z0-9]$/u;

function requiredString(value, name) {
  const normalized = typeof value === "string" ? value.trim() : "";

  if (!normalized || PLACEHOLDER_PATTERN.test(normalized)) {
    throw new Error(`MOB-13 production release input ${name} is missing or is a placeholder.`);
  }

  return normalized;
}

function productionOrigin(value, name) {
  const normalized = requiredString(value, name);
  let url;

  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`MOB-13 production release input ${name} must be a valid URL.`);
  }

  const hostname = url.hostname.toLowerCase();
  const isLocalOrReserved =
    !hostname.includes(".")
    || hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "0.0.0.0"
    || hostname === "::1"
    || isIP(hostname) !== 0
    || hostname.endsWith(".local")
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".test")
    || hostname.endsWith(".invalid")
    || hostname === "example.com"
    || hostname.endsWith(".example.com");

  if (
    url.protocol !== "https:"
    || isLocalOrReserved
    || url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error(
      `MOB-13 production release input ${name} must be a public HTTPS origin without credentials, a path, query, or fragment.`,
    );
  }

  return url.origin;
}

function auditProductionReleaseReadiness(manifest, environment) {
  const checks = [];
  const add = (id, ready, blockedReason) => {
    checks.push({
      id,
      status: ready ? "PASS" : "BLOCKED",
      ...(ready ? {} : { reason: blockedReason }),
    });
  };
  const valid = (operation) => {
    try {
      operation();
      return true;
    } catch {
      return false;
    }
  };
  const assetExists = (asset) => (
    typeof asset === "string"
    && asset.trim().length > 0
    && existsSync(path.resolve(__dirname, asset))
  );

  add(
    "manifest_status",
    manifest.status === "READY",
    "Release manifest approval is still required.",
  );
  add(
    "eas_identity",
    valid(() => {
      const owner = requiredString(manifest.eas?.owner, "eas.owner");
      const projectId = requiredString(manifest.eas?.projectId, "eas.projectId");
      if (!EAS_OWNER_PATTERN.test(owner) || !EAS_PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Invalid EAS identity.");
      }
    }),
    "Approved EAS owner and project ID are missing or invalid.",
  );

  const apiOriginReady = valid(() => {
    const approved = productionOrigin(
      manifest.endpoints?.tindioApiOrigin,
      "endpoints.tindioApiOrigin",
    );
    const embedded = productionOrigin(
      environment.EXPO_PUBLIC_TINDIO_API_URL,
      "EXPO_PUBLIC_TINDIO_API_URL",
    );
    if (approved !== embedded) throw new Error("API origin mismatch.");
  });
  add(
    "production_api_origin",
    apiOriginReady,
    "Approved and embedded public HTTPS API origins are missing, invalid, or different.",
  );

  const supabaseOriginReady = valid(() => {
    const approved = productionOrigin(
      manifest.endpoints?.supabaseAuthOrigin,
      "endpoints.supabaseAuthOrigin",
    );
    const embedded = productionOrigin(
      environment.EXPO_PUBLIC_SUPABASE_URL,
      "EXPO_PUBLIC_SUPABASE_URL",
    );
    if (approved !== embedded) throw new Error("Supabase Auth origin mismatch.");
  });
  add(
    "supabase_auth_origin",
    supabaseOriginReady,
    "Approved and embedded public HTTPS Supabase Auth origins are missing, invalid, or different.",
  );
  add(
    "supabase_publishable_key",
    valid(() => requiredString(
      environment.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    )),
    "The production Supabase publishable key is not available to the build environment.",
  );
  add(
    "remote_signing",
    manifest.signing?.credentialsSource === "remote"
      && manifest.signing?.status === "VERIFIED"
      && Boolean(manifest.signing?.verifiedAt),
    "Remote Android signing credentials have not been verified.",
  );

  const branding = manifest.branding ?? {};
  add(
    "branding_approval",
    branding.status === "APPROVED",
    "Product-owner approval of the candidate branding is required.",
  );
  add(
    "branding_assets",
    [branding.appIcon, branding.adaptiveForeground, branding.splash]
      .every(assetExists),
    "One or more required branding assets are missing.",
  );

  const listing = manifest.storeListing ?? {};
  add(
    "listing_approval",
    listing.status === "READY",
    "Google Play listing approval is required.",
  );
  add(
    "listing_copy",
    typeof listing.shortDescription === "string"
      && listing.shortDescription.trim().length > 0
      && listing.shortDescription.length <= 80
      && typeof listing.fullDescription === "string"
      && listing.fullDescription.trim().length > 0,
    "Approved short and full descriptions are required.",
  );
  add(
    "support_email",
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(listing.supportEmail ?? ""),
    "A monitored support email is required.",
  );
  add(
    "feature_graphic",
    assetExists(listing.featureGraphic),
    "The approved feature graphic is missing.",
  );
  add(
    "phone_screenshots",
    Array.isArray(listing.phoneScreenshots)
      && listing.phoneScreenshots.length > 0
      && listing.phoneScreenshots.every(assetExists),
    "Truthful release-candidate phone screenshots are required.",
  );
  const tabletScreenshots = [
    ...(listing.sevenInchTabletScreenshots ?? []),
    ...(listing.tenInchTabletScreenshots ?? []),
  ];
  add(
    "tablet_screenshot_paths",
    tabletScreenshots.every(assetExists),
    "One or more configured tablet screenshots are missing.",
  );
  add(
    "public_policy_evidence_file",
    typeof manifest.publicPolicyEvidencePath === "string"
      && existsSync(path.resolve(__dirname, "../..", manifest.publicPolicyEvidencePath)),
    "The Phase 24 public-policy evidence file is missing.",
  );

  const blocked = checks
    .filter((check) => check.status === "BLOCKED")
    .map((check) => check.id);

  return {
    schemaVersion: 1,
    status: blocked.length === 0 ? "READY" : "BLOCKED",
    checks,
    blocked,
  };
}

function assertProductionReleaseInputs(manifest, environment) {
  if (manifest.status !== "READY") {
    throw new Error(
      "MOB-13_PRODUCTION_RELEASE_BLOCKED: apps/mobile/production-release.json is not READY.",
    );
  }

  const owner = requiredString(manifest.eas?.owner, "eas.owner");
  const projectId = requiredString(manifest.eas?.projectId, "eas.projectId");

  if (!EAS_OWNER_PATTERN.test(owner)) {
    throw new Error("MOB-13 production release input eas.owner is invalid.");
  }

  if (!EAS_PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error("MOB-13 production release input eas.projectId must be a UUID.");
  }

  const approvedApiOrigin = productionOrigin(
    manifest.endpoints?.tindioApiOrigin,
    "endpoints.tindioApiOrigin",
  );
  const approvedSupabaseOrigin = productionOrigin(
    manifest.endpoints?.supabaseAuthOrigin,
    "endpoints.supabaseAuthOrigin",
  );
  const embeddedApiOrigin = productionOrigin(
    environment.EXPO_PUBLIC_TINDIO_API_URL,
    "EXPO_PUBLIC_TINDIO_API_URL",
  );
  const embeddedSupabaseOrigin = productionOrigin(
    environment.EXPO_PUBLIC_SUPABASE_URL,
    "EXPO_PUBLIC_SUPABASE_URL",
  );

  if (embeddedApiOrigin !== approvedApiOrigin) {
    throw new Error("MOB-13 production API origin does not match the approved release manifest.");
  }

  if (embeddedSupabaseOrigin !== approvedSupabaseOrigin) {
    throw new Error("MOB-13 Supabase Auth origin does not match the approved release manifest.");
  }

  requiredString(
    environment.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  );

  if (
    manifest.signing?.credentialsSource !== "remote"
    || manifest.signing?.status !== "VERIFIED"
    || !manifest.signing?.verifiedAt
  ) {
    throw new Error("MOB-13 production remote signing credentials are not verified.");
  }

  const branding = manifest.branding ?? {};
  if (branding.status !== "APPROVED") {
    throw new Error("MOB-13 production branding is not approved.");
  }

  for (const name of [
    "appIcon",
    "adaptiveForeground",
    "splash",
  ]) {
    const asset = requiredString(branding[name], `branding.${name}`);
    if (!existsSync(path.resolve(__dirname, asset))) {
      throw new Error(`MOB-13 production branding asset is missing: ${asset}`);
    }
  }

  const listing = manifest.storeListing ?? {};
  const featureGraphic = typeof listing.featureGraphic === "string"
    ? listing.featureGraphic.trim()
    : "";
  const phoneScreenshots = Array.isArray(listing.phoneScreenshots)
    ? listing.phoneScreenshots
    : [];
  if (
    listing.status !== "READY"
    || !featureGraphic
    || phoneScreenshots.length === 0
    || typeof listing.shortDescription !== "string"
    || listing.shortDescription.trim().length === 0
    || listing.shortDescription.length > 80
    || typeof listing.fullDescription !== "string"
    || listing.fullDescription.trim().length === 0
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(listing.supportEmail ?? "")
  ) {
    throw new Error("MOB-13 Google Play listing inputs are incomplete.");
  }

  for (const asset of [
    featureGraphic,
    ...phoneScreenshots,
    ...(listing.sevenInchTabletScreenshots ?? []),
    ...(listing.tenInchTabletScreenshots ?? []),
  ]) {
    if (!existsSync(path.resolve(__dirname, asset))) {
      throw new Error(`MOB-13 Google Play listing asset is missing: ${asset}`);
    }
  }

  return {
    owner,
    projectId,
  };
}

module.exports = {
  auditProductionReleaseReadiness,
  assertProductionReleaseInputs,
  productionOrigin,
};
