import {
  readFile,
  writeFile,
} from "node:fs/promises";

import path from "node:path";
import process from "node:process";

const ROOT =
  process.cwd();

const evidencePath =
  path.join(
    ROOT,
    "test-results",
    "phase-14",
    "browser-evidence.json",
  );

const manualPath =
  path.join(
    ROOT,
    "docs",
    "recovery",
    "phase-14-manual-certification.md",
  );

const expectedIds =
  Array.from(
    {
      length: 20,
    },
    (_, index) =>
      `P14-BR-${String(index + 1).padStart(2, "0")}`,
  );

function fail(message) {
  console.error(message);
  process.exit(1);
}

let records;

try {
  records =
    JSON.parse(
      await readFile(
        evidencePath,
        "utf8",
      ),
    );
} catch {
  fail(
    "Phase 14 browser evidence JSON is missing.",
  );
}

if (
  !Array.isArray(records)
) {
  fail(
    "Phase 14 browser evidence is not an array.",
  );
}

const byId =
  new Map(
    records.map(
      (record) => [
        record.id,
        record,
      ],
    ),
  );

for (
  const id
  of expectedIds
) {
  const record =
    byId.get(id);

  if (
    !record
    || record.status !== "PASS"
    || typeof record.evidence !== "string"
    || record.evidence.trim().length < 20
  ) {
    fail(
      `${id} does not contain complete PASS evidence.`,
    );
  }
}

let manual =
  await readFile(
    manualPath,
    "utf8",
  );

manual =
  manual.replace(
    /^FINAL_MANUAL_STATUS:\s*\w+$/m,
    "FINAL_MANUAL_STATUS: PASS",
  );

for (
  const id
  of expectedIds
) {
  const record =
    byId.get(id);

  const escapedId =
    id.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );

  manual =
    manual.replace(
      new RegExp(
        `\\|\\s*${escapedId}\\s*\\|\\s*(?:PENDING|FAIL|BLOCKED|PASS)\\s*\\|`,
      ),
      `| ${id} | PASS |`,
    );

  const sectionPattern =
    new RegExp(
      `### ${escapedId}\\s*\\n- Evidence:\\s*(?:.*\\n)?`,
    );

  const section =
    `### ${id}\n- Evidence: ${record.evidence}\n`;

  if (
    sectionPattern.test(manual)
  ) {
    manual =
      manual.replace(
        sectionPattern,
        section,
      );
  } else {
    manual +=
      `\n${section}`;
  }
}

if (
  /\|\s*P14-BR-\d+\s*\|\s*(?:PENDING|FAIL|BLOCKED)\s*\|/
    .test(manual)
) {
  fail(
    "Manual certification still contains an incomplete browser row.",
  );
}

await writeFile(
  manualPath,
  manual,
  "utf8",
);

console.log(
  "PHASE 14 BROWSER EVIDENCE MATERIALIZED: PASS",
);
