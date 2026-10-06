import assert from "node:assert/strict";

export const CANONICAL_PRODUCTION_NEON_TARGET = Object.freeze({
  projectId: "divine-sound-41148108",
  branchId: "br-snowy-heart-b5nf6q3n",
  hostname: "ep-wandering-voice-b5w9m9db.c-7.us-east-2.aws.neon.tech",
  databaseName: "tindio_r6_recovery",
});

export function requireCanonicalProductionNeonTarget(
  value,
) {
  assert.ok(
    value,
    "DATABASE_URL_UNPOOLED is required.",
  );

  const parsed = new URL(value);
  const hostname = parsed.hostname.toLowerCase();
  const databaseName = decodeURIComponent(
    parsed.pathname.replace(/^\//, ""),
  );

  assert.equal(
    parsed.protocol,
    "postgresql:",
    "Production hosted apply requires a PostgreSQL URL.",
  );
  assert.ok(
    hostname.endsWith(".neon.tech") && !hostname.includes("-pooler"),
    "Production hosted apply requires the canonical direct/unpooled Neon endpoint.",
  );
  assert.equal(
    hostname,
    CANONICAL_PRODUCTION_NEON_TARGET.hostname,
    "Production hosted apply target is not the canonical Neon branch.",
  );
  assert.equal(
    databaseName,
    CANONICAL_PRODUCTION_NEON_TARGET.databaseName,
    "Production hosted apply target is not the canonical TINDIO database.",
  );

  return {
    databaseUrl: value,
    parsed,
  };
}
