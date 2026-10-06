import assert from "node:assert/strict";
import test from "node:test";

import {
  CANONICAL_PRODUCTION_NEON_TARGET,
  requireCanonicalProductionNeonTarget,
} from "./lib/canonical-production-neon-target.mjs";

const canonicalUrl =
  "postgresql://tindio_r6_recovery_owner:non-secret-test-value@ep-wandering-voice-b5w9m9db.c-7.us-east-2.aws.neon.tech/tindio_r6_recovery?sslmode=require";

test("canonical production hosted commands accept only the canonical direct target", () => {
  const actual = requireCanonicalProductionNeonTarget(canonicalUrl);

  assert.equal(actual.databaseUrl, canonicalUrl);
  assert.equal(actual.parsed.hostname, CANONICAL_PRODUCTION_NEON_TARGET.hostname);
});

test("canonical production hosted commands fail closed for retained old or pooled targets", () => {
  assert.throws(
    () => requireCanonicalProductionNeonTarget(
      "postgresql://owner:non-secret-test-value@ep-lively-glitter-a123.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require",
    ),
    /not the canonical Neon branch|not the canonical TINDIO database/,
  );
  assert.throws(
    () => requireCanonicalProductionNeonTarget(
      "postgresql://owner:non-secret-test-value@ep-wandering-voice-b5w9m9db-pooler.c-7.us-east-2.aws.neon.tech/tindio_r6_recovery?sslmode=require",
    ),
    /canonical direct\/unpooled Neon endpoint/,
  );
});
