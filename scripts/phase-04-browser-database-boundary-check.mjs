import assert from "node:assert/strict";
import {
  readdir,
  readFile,
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root =
  process.cwd();

async function walk(
  directory,
) {
  const entries =
    await readdir(
      directory,
      {
        withFileTypes: true,
      },
    );

  const files = [];

  for (
    const entry
    of entries
  ) {
    const target =
      path.join(
        directory,
        entry.name,
      );

    if (
      entry.isDirectory()
    ) {
      files.push(
        ...await walk(
          target,
        ),
      );

      continue;
    }

    if (
      entry.isFile()
      && /\.(?:ts|tsx)$/
        .test(
          entry.name,
        )
    ) {
      files.push(
        target,
      );
    }
  }

  return files;
}

test(
  "browser Supabase clients are auth/realtime only and do not keep business data on the old database",
  async () => {
    const files =
      await walk(
        path.join(
          root,
          "src",
        ),
      );

    const offenders = [];

    for (
      const file
      of files
    ) {
      const source =
        await readFile(
          file,
          "utf8",
        );

      if (
        !source.includes(
          "@/lib/supabase/client",
        )
      ) {
        continue;
      }

      if (
        /\.from\s*\(|\.rpc\s*\(/
          .test(
            source,
          )
      ) {
        offenders.push(
          path.relative(
            root,
            file,
          ).replaceAll(
            "\\",
            "/",
          ),
        );
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `Browser-side database access would create split-brain data after Neon cutover: ${offenders.join(", ")}`,
    );
  },
);
