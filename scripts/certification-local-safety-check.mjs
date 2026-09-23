import assert from "node:assert/strict";

import {
  spawnSync,
} from "node:child_process";

import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";

import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  fileURLToPath,
} from "node:url";

import {
  verifyGeneratedTextContract,
} from "./lib/certification-contract.mjs";

import {
  parseAndValidateLocalSupabaseStatus,
} from "./lib/certification-safety.mjs";

const scriptDirectory =
  path.dirname(
    fileURLToPath(
      import.meta.url,
    ),
  );

const preflightScript =
  path.join(
    scriptDirectory,
    "certification-local-target-preflight.mjs",
  );

function validStatus(
  overrides = {},
) {
  return JSON.stringify({
    API_URL:
      "http://127.0.0.1:54321",

    DB_URL:
      "postgresql://postgres:secret@127.0.0.1:54322/postgres",

    STUDIO_URL:
      "http://localhost:54323",

    ...overrides,
  });
}

function sanitizedEnvironment(
  overrides = {},
) {
  const env = {
    ...process.env,
  };

  for (
    const key
    of [
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_URL",
      "DATABASE_URL",
      "DIRECT_URL",
      "POSTGRES_URL",
      "SUPABASE_DB_URL",
      "NEON_DATABASE_URL",
    ]
  ) {
    delete env[key];
  }

  return {
    ...env,
    ...overrides,
  };
}

test(
  "status parser accepts the required local API and database services",
  () => {
    const result =
      parseAndValidateLocalSupabaseStatus(
        validStatus(),
      );

    assert.equal(
      result.API_URL.hostname,
      "127.0.0.1",
    );

    assert.equal(
      result.API_URL.protocol,
      "http:",
    );

    assert.equal(
      result.DB_URL.hostname,
      "127.0.0.1",
    );

    assert.equal(
      result.DB_URL.protocol,
      "postgresql:",
    );
  },
);

test(
  "status parser requires API_URL and DB_URL",
  () => {
    assert.throws(
      () =>
        parseAndValidateLocalSupabaseStatus(
          JSON.stringify({
            DB_URL:
              "postgresql://postgres@127.0.0.1:54322/postgres",
          }),
        ),
      /missing required API_URL/,
    );

    assert.throws(
      () =>
        parseAndValidateLocalSupabaseStatus(
          JSON.stringify({
            API_URL:
              "http://127.0.0.1:54321",
          }),
        ),
      /missing required DB_URL/,
    );
  },
);

test(
  "status parser rejects wrongly typed or malformed critical fields",
  () => {
    assert.throws(
      () =>
        parseAndValidateLocalSupabaseStatus(
          validStatus({
            API_URL: 54321,
          }),
        ),
      /API_URL must be a non-empty string/,
    );

    assert.throws(
      () =>
        parseAndValidateLocalSupabaseStatus(
          validStatus({
            DB_URL: {
              host: "127.0.0.1",
            },
          }),
        ),
      /DB_URL must be a non-empty string/,
    );

    assert.throws(
      () =>
        parseAndValidateLocalSupabaseStatus(
          validStatus({
            API_URL:
              "not-a-url",
          }),
        ),
      /API_URL is not a valid URL/,
    );
  },
);

test(
  "status parser rejects remote hosts and wrong protocols without echoing secrets",
  () => {
    const secret =
      "do-not-print-this-password";

    assert.throws(
      () =>
        parseAndValidateLocalSupabaseStatus(
          validStatus({
            API_URL:
              "https://supabase.example.com",
          }),
        ),
      /API_URL resolved a non-local host/,
    );

    assert.throws(
      () =>
        parseAndValidateLocalSupabaseStatus(
          validStatus({
            DB_URL:
              `postgresql://postgres:${secret}@db.example.com:5432/postgres`,
          }),
        ),
      (error) => {
        assert.match(
          error.message,
          /DB_URL resolved a non-local host/,
        );

        assert.doesNotMatch(
          error.message,
          new RegExp(secret),
        );

        return true;
      },
    );

    assert.throws(
      () =>
        parseAndValidateLocalSupabaseStatus(
          validStatus({
            API_URL:
              "file://localhost/tmp/api",
          }),
        ),
      /API_URL uses an unsupported protocol/,
    );

    assert.throws(
      () =>
        parseAndValidateLocalSupabaseStatus(
          validStatus({
            DB_URL:
              "https://127.0.0.1:54322/postgres",
          }),
        ),
      /DB_URL uses an unsupported protocol/,
    );
  },
);

test(
  "environment preflight permits hosted Supabase Auth because destructive DB targeting is separately local-only",
  async () => {
    const temporaryRoot =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "tindio-cert-preflight-",
        ),
      );

    try {
      const result =
        spawnSync(
          process.execPath,
          [
            preflightScript,
          ],
          {
            cwd:
              temporaryRoot,

            encoding:
              "utf8",

            env:
              sanitizedEnvironment({
                NEXT_PUBLIC_SUPABASE_URL:
                  "https://remote-project.supabase.co",
              }),
          },
        );

      assert.equal(
        result.status,
        0,
        result.stderr
          || result.stdout,
      );

      assert.match(
        result.stdout,
        /NEXT_PUBLIC_SUPABASE_URL: REMOTE \(HOSTED AUTH ALLOWED; NOT A DESTRUCTIVE DB TARGET\)/,
      );

      assert.match(
        result.stdout,
        /Authoritative local database safety is enforced separately/,
      );

      assert.doesNotMatch(
        `${result.stdout}\n${result.stderr}`,
        /remote-project\.supabase\.co/,
      );
    } finally {
      await rm(
        temporaryRoot,
        {
          recursive: true,
          force: true,
        },
      );
    }
  },
);

test(
  "environment preflight permits a local app target while remote database configuration remains informational",
  async () => {
    const temporaryRoot =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "tindio-cert-preflight-",
        ),
      );

    try {
      const result =
        spawnSync(
          process.execPath,
          [
            preflightScript,
          ],
          {
            cwd:
              temporaryRoot,

            encoding:
              "utf8",

            env:
              sanitizedEnvironment({
                NEXT_PUBLIC_SUPABASE_URL:
                  "http://127.0.0.1:54321",

                DATABASE_URL:
                  "postgresql://remote.example.com/production",
              }),
          },
        );

      assert.equal(
        result.status,
        0,
        result.stderr
          || result.stdout,
      );

      assert.match(
        result.stdout,
        /NEXT_PUBLIC_SUPABASE_URL: LOCAL/,
      );

      assert.match(
        result.stdout,
        /DATABASE_URL: REMOTE \(NOT USED BY LOCAL CERTIFICATION\)/,
      );

      assert.doesNotMatch(
        `${result.stdout}\n${result.stderr}`,
        /remote\.example\.com/,
      );
    } finally {
      await rm(
        temporaryRoot,
        {
          recursive: true,
          force: true,
        },
      );
    }
  },
);

test(
  "generated contract restores original bytes after line-ending-only generation",
  async () => {
    const temporaryRoot =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "tindio-contract-",
        ),
      );

    const target =
      path.join(
        temporaryRoot,
        "database.types.ts",
      );

    const original =
      "export type Row = {\r\n  id: string;\r\n};\r\n";

    try {
      await writeFile(
        target,
        original,
        "utf8",
      );

      const result =
        await verifyGeneratedTextContract({
          filePath:
            target,

          label:
            "Database type contract",

          generate:
            async () => {
              await writeFile(
                target,
                original.replaceAll(
                  "\r\n",
                  "\n",
                ),
                "utf8",
              );

              return {
                status: 0,
                error: null,
              };
            },
        });

      assert.equal(
        result.bytesChanged,
        true,
      );

      assert.equal(
        await readFile(
          target,
          "utf8",
        ),
        original,
      );
    } finally {
      await rm(
        temporaryRoot,
        {
          recursive: true,
          force: true,
        },
      );
    }
  },
);

test(
  "generated contract restores original bytes when generation fails after a partial write",
  async () => {
    const temporaryRoot =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "tindio-contract-",
        ),
      );

    const target =
      path.join(
        temporaryRoot,
        "database.types.ts",
      );

    const original =
      "export type Stable = true;\n";

    try {
      await writeFile(
        target,
        original,
        "utf8",
      );

      await assert.rejects(
        verifyGeneratedTextContract({
          filePath:
            target,

          label:
            "Database type contract",

          generate:
            async () => {
              await writeFile(
                target,
                "partial generated output\n",
                "utf8",
              );

              return {
                status: 1,
                error: null,
                stdout: "",
                stderr:
                  "generation failed",
              };
            },
        }),
        /Database type contract generation command failed/,
      );

      assert.equal(
        await readFile(
          target,
          "utf8",
        ),
        original,
      );
    } finally {
      await rm(
        temporaryRoot,
        {
          recursive: true,
          force: true,
        },
      );
    }
  },
);

test(
  "generated contract restores original bytes when generated content drifts",
  async () => {
    const temporaryRoot =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "tindio-contract-",
        ),
      );

    const target =
      path.join(
        temporaryRoot,
        "database.types.ts",
      );

    const original =
      "export type Stable = true;\n";

    try {
      await writeFile(
        target,
        original,
        "utf8",
      );

      await assert.rejects(
        verifyGeneratedTextContract({
          filePath:
            target,

          label:
            "Database type contract",

          generate:
            async () => {
              await writeFile(
                target,
                "export type Stable = false;\n",
                "utf8",
              );

              return {
                status: 0,
                error: null,
              };
            },
        }),
        /Database type contract drifted from the checked-in contract/,
      );

      assert.equal(
        await readFile(
          target,
          "utf8",
        ),
        original,
      );
    } finally {
      await rm(
        temporaryRoot,
        {
          recursive: true,
          force: true,
        },
      );
    }
  },
);

test(
  "authoritative certification includes untracked migration files in its cleanliness gate",
  async () => {
    const source =
      await readFile(
        new URL(
          "./certify-repository.mjs",
          import.meta.url,
        ),
        "utf8",
      );

    assert.match(
      source,
      /--untracked-files=all/,
    );

    assert.doesNotMatch(
      source,
      /--untracked-files=no/,
    );
  },
);
