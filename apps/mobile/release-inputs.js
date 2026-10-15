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

  for (const [name, status] of Object.entries(manifest.branding ?? {})) {
    if (status !== "APPROVED") {
      throw new Error(`MOB-13 production branding ${name} is not approved.`);
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
    || !listing.shortDescription
    || !listing.fullDescription
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
  assertProductionReleaseInputs,
  productionOrigin,
};
