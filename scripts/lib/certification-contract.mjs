import {
  createHash,
} from "node:crypto";

import {
  readFile,
  writeFile,
} from "node:fs/promises";

function normalizedTextHash(
  value,
) {
  return createHash(
    "sha256",
  )
    .update(
      value.replaceAll(
        "\r\n",
        "\n",
      ),
    )
    .digest(
      "hex",
    );
}

async function restoreOriginalText(
  filePath,
  original,
) {
  let current = null;

  try {
    current =
      await readFile(
        filePath,
        "utf8",
      );
  } catch {
    current = null;
  }

  if (
    current !== original
  ) {
    await writeFile(
      filePath,
      original,
      "utf8",
    );
  }
}

export async function verifyGeneratedTextContract({
  filePath,
  generate,
  label = "Generated contract",
}) {
  if (
    typeof generate !== "function"
  ) {
    throw new TypeError(
      "generate must be a function.",
    );
  }

  const before =
    await readFile(
      filePath,
      "utf8",
    );

  try {
    const commandResult =
      await generate();

    if (
      !commandResult
      || commandResult.error
      || commandResult.status !== 0
    ) {
      const error =
        new Error(
          `${label} generation command failed.`,
        );

      error.commandResult =
        commandResult ?? null;

      throw error;
    }

    const after =
      await readFile(
        filePath,
        "utf8",
      );

    if (
      normalizedTextHash(before)
      !== normalizedTextHash(after)
    ) {
      throw new Error(
        `${label} drifted from the checked-in contract.`,
      );
    }

    return {
      bytesChanged:
        before !== after,
    };
  } finally {
    /*
     * Always restore the original repository bytes:
     * - successful identical generation;
     * - line-ending-only generation;
     * - schema drift;
     * - generator failure after a partial write;
     * - generator failure after removing/replacing the file.
     */
    await restoreOriginalText(
      filePath,
      before,
    );
  }
}
