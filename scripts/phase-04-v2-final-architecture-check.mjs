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
  page,
  shell,
  terminal,
  browserApi,
  offlineStore,
  coreRoute,
  referenceRoute,
  liveRoute,
  catalogRoute,
  modifiersRoute,
  finalCertifier,
] = await Promise.all([
  source("src/app/(pos)/pos/page.tsx"),
  source("src/features/pos/pos-v2-terminal-shell.tsx"),
  source("src/features/pos/pos-terminal.tsx"),
  source("src/features/pos/pos-v2-browser-api.ts"),
  source("src/features/offline/offline-store.ts"),
  source("src/app/api/pos/v2/bootstrap/route.ts"),
  source("src/app/api/pos/v2/reference/route.ts"),
  source("src/app/api/pos/v2/live/route.ts"),
  source("src/app/api/pos/v2/catalog/route.ts"),
  source("src/app/api/pos/v2/modifiers/route.ts"),
  source("scripts/phase-04-v2-final-deployed-certification.mjs"),
]);

test(
  "active POS sales startup is V2, not the V1 monolithic workspace",
  () => {
    assert.match(page, /PosV2TerminalShell/);
    assert.doesNotMatch(
      page,
      new RegExp(
        [
          "loadPos",
          "Workspace",
        ].join(""),
      ),
    );
    assert.doesNotMatch(page, /requireBusinessContext/);
  },
);

test(
  "progressive domains are independent",
  () => {
    assert.match(shell, /fetchPosV2Core/);
    assert.match(shell, /fetchPosV2Reference/);
    assert.match(shell, /fetchPosV2Live/);
    assert.match(
      shell,
      /Reference data is cached and may be out of date/,
    );
    assert.match(
      shell,
      /POS configuration is temporarily unavailable/,
    );
    assert.match(
      shell,
      /Live POS tools are temporarily unavailable/,
    );
  },
);

test(
  "terminal catalog and modifiers use V2",
  () => {
    assert.match(terminal, /fetchPosV2Catalog/);
    assert.match(terminal, /fetchPosV2Modifiers/);
    assert.doesNotMatch(
      terminal,
      /fetch\(["'`]\/api\/pos\/catalog/,
    );
    assert.doesNotMatch(
      terminal,
      /fetch\(["'`]\/api\/pos\/modifiers/,
    );
  },
);

test(
  "browser V2 transport supports one auth refresh without logging secrets",
  () => {
    assert.match(browserApi, /refreshSession/);
    assert.match(browserApi, /response\.status === 401/);
    assert.doesNotMatch(
      browserApi,
      /console\.(?:log|warn|error)\([^)]*(?:token|password|authorization|cookie)/i,
    );
  },
);

test(
  "offline boundaries include V2 reference and existing catalog/runtime stores",
  () => {
    assert.match(offlineStore, /DATABASE_VERSION\s*=\s*4/);
    assert.match(offlineStore, /pos-reference-snapshots/);
    assert.match(offlineStore, /catalog-snapshots/);
    assert.match(offlineStore, /pos-runtime-snapshots/);
    assert.match(offlineStore, /checkout-queue/);
  },
);

test(
  "all V2 API domains exist",
  () => {
    for (
      const route of [
        coreRoute,
        referenceRoute,
        liveRoute,
        catalogRoute,
        modifiersRoute,
      ]
    ) {
      assert.match(route, /x-tindio-request-id/);
    }
  },
);

test(
  "direct V2 exposure preflight retries only identity mapping",
  () => {
    assert.match(
      finalCertifier,
      /directCoreBody\?\.reason === "IDENTITY_UNMAPPED"/,
    );

    assert.match(
      finalCertifier,
      /await sleep\(100\)[\s\S]*directCore =\s*await directCoreRequest\(\)/,
    );
  },
);
