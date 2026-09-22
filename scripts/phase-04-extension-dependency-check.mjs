import assert from "node:assert/strict";
import {
  readFile,
} from "node:fs/promises";
import test from "node:test";

const baseline =
  await readFile(
    new URL(
      "../database/baseline/0001_tindio_baseline.sql",
      import.meta.url,
    ),
    "utf8",
  );

const bootstrap =
  await readFile(
    new URL(
      "../database/provider/neon/00_extensions.sql",
      import.meta.url,
    ),
    "utf8",
  );

function normalizeIdentifier(
  value,
) {
  return value
    .replaceAll(
      '"',
      "",
    )
    .trim();
}

function unique(
  values,
) {
  return [
    ...new Set(
      values,
    ),
  ].sort();
}

test(
  "canonical baseline extension-schema dependencies are fully inventoried",
  () => {
    const rawReferences =
      [
        ...baseline.matchAll(
          /(?:"extensions"|extensions)\s*\.\s*(?:"([A-Za-z_][A-Za-z0-9_]*)"|([A-Za-z_][A-Za-z0-9_]*))/g,
        ),
      ].map(
        (match) =>
          normalizeIdentifier(
            match[1]
            ?? match[2]
            ?? "",
          ),
      );

    const references =
      unique(
        rawReferences,
      );

    assert.deepEqual(
      references,
      [
        "crypt",
        "digest",
        "gen_salt",
        "gin_trgm_ops",
      ],
      `Unexpected extensions-schema dependency set: ${references.join(", ")}`,
    );
  },
);

test(
  "Neon extension bootstrap provides pgcrypto and pg_trgm",
  () => {
    assert.match(
      bootstrap,
      /create extension if not exists pgcrypto[\s\S]*with schema extensions/i,
    );

    assert.match(
      bootstrap,
      /create extension if not exists pg_trgm[\s\S]*with schema extensions/i,
    );

    assert.match(
      bootstrap,
      /extensions\.crypt\(text,text\)/i,
    );

    assert.match(
      bootstrap,
      /extensions\.gen_salt\(text,integer\)/i,
    );

    assert.match(
      bootstrap,
      /extensions\.digest\(text,text\)/i,
    );

    assert.match(
      bootstrap,
      /gin_trgm_ops/i,
    );

    assert.match(
      bootstrap,
      /gist_trgm_ops/i,
    );
  },
);
