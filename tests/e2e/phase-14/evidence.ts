import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";

import path from "node:path";

const evidenceDirectory =
  path.resolve(
    "test-results",
    "phase-14",
  );

const evidencePath =
  path.join(
    evidenceDirectory,
    "browser-evidence.json",
  );

export type Phase14Evidence = {
  id: string;
  status: "PASS";
  evidence: string;
};

async function readEvidence() {
  try {
    return JSON.parse(
      await readFile(
        evidencePath,
        "utf8",
      ),
    ) as Phase14Evidence[];
  } catch {
    return [];
  }
}

export async function resetEvidence() {
  await mkdir(
    evidenceDirectory,
    {
      recursive: true,
    },
  );

  await writeFile(
    evidencePath,
    "[]\n",
    "utf8",
  );
}

export async function recordEvidence(
  id: string,
  evidence: string,
) {
  if (
    !/^P14-BR-(?:0[1-9]|1\d|20)$/
      .test(id)
  ) {
    throw new Error(
      `Invalid Phase 14 evidence id: ${id}`,
    );
  }

  const normalized =
    evidence
      .replaceAll(/\s+/g, " ")
      .trim();

  if (
    normalized.length < 20
  ) {
    throw new Error(
      `${id} evidence is too vague.`,
    );
  }

  if (
    /password|cookie|token|service.?role|secret/i
      .test(normalized)
  ) {
    throw new Error(
      `${id} evidence appears to contain sensitive credential material.`,
    );
  }

  const records =
    await readEvidence();

  const next = [
    ...records.filter(
      (record) =>
        record.id !== id,
    ),

    {
      id,
      status: "PASS" as const,
      evidence: normalized,
    },
  ].sort(
    (left, right) =>
      left.id.localeCompare(
        right.id,
      ),
  );

  await writeFile(
    evidencePath,
    `${JSON.stringify(next, null, 2)}\n`,
    "utf8",
  );
}
