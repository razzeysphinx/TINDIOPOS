import { createRequire } from "node:module";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const {
  auditProductionReleaseReadiness,
} = require("../apps/mobile/release-inputs.js");

const manifest = JSON.parse(
  fs.readFileSync("apps/mobile/production-release.json", "utf8"),
);
const report = auditProductionReleaseReadiness(manifest, process.env);

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (report.status !== "READY") {
  process.stderr.write(
    "MOB-13_RELEASE_READINESS_BLOCKED: do not build or submit the production AAB.\n",
  );
  process.exitCode = 1;
}
