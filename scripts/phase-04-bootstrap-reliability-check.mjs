import assert from "node:assert/strict";
import {
  readFile,
} from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(
    new URL(
      `../${path}`,
      import.meta.url,
    ),
    "utf8",
  );
}

const [
  route,
  workspace,
  neonFetch,
] =
  await Promise.all([
    source(
      "src/app/api/pos/v1/bootstrap/route.ts",
    ),

    source(
      "src/features/pos/data.ts",
    ),

    source(
      "src/lib/database/neon-data-api-fetch.ts",
    ),
  ]);

test(
  "POS bootstrap retry is bounded and read-only scoped",
  () => {
    assert.match(
      route,
      /MAX_WORKSPACE_ATTEMPTS\s*=\s*2/,
    );

    assert.match(
      route,
      /loadWorkspaceWithRetry/,
    );

    assert.match(
      route,
      /loadPosWorkspace/,
    );

    assert.match(
      route,
      /x-tindio-bootstrap-attempts/,
    );

    assert.match(
      route,
      /x-tindio-request-id/,
    );

    assert.doesNotMatch(
      route,
      /checkout|payment|clockIn|clockOut|createSale|mutat/i,
    );
  },
);

test(
  "POS workspace reads are split into bounded waves",
  () => {
    for (
      const stage
      of [
        "core-catalog",
        "payment-shift-loyalty",
        "tax-dining-ticket-display",
        "time-clock-transfers",
        "active-shift-catalog",
        "active-shift-ticketing",
      ]
    ) {
      assert.match(
        workspace,
        new RegExp(stage),
      );
    }

    assert.doesNotMatch(
      workspace,
      /const\s*\[\s*storesResult[\s\S]*incomingTransfersResult\s*\]\s*=\s*await\s+Promise\.all/,
    );
  },
);

test(
  "Neon failures expose safe downstream endpoint metadata",
  () => {
    assert.match(
      neonFetch,
      /Neon Data API request failed/,
    );

    assert.match(
      neonFetch,
      /status:/,
    );

    assert.match(
      neonFetch,
      /method:/,
    );

    assert.match(
      neonFetch,
      /pathname:/,
    );

    assert.doesNotMatch(
      neonFetch,
      /console\.(?:log|warn|error)\([\s\S]*authorization/i,
    );
  },
);
