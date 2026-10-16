import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const evidencePath = path.join(
  root,
  "docs/mobile-program/evidence/MOB_13_SLICE_14_PHYSICAL_ANDROID_UI.json",
);

function existingFile(candidates) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) ?? null;
}

function run(file, args) {
  try {
    return {
      ok: true,
      output: execFileSync(file, args, {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 10_000,
      }).trim(),
    };
  } catch (error) {
    return {
      ok: false,
      output: String(error.stderr ?? error.message).trim(),
    };
  }
}

function adbCandidates() {
  return [
    process.env.MOB13_ADB_PATH,
    process.env.ANDROID_SDK_ROOT &&
      path.join(process.env.ANDROID_SDK_ROOT, "platform-tools", "adb.exe"),
    process.env.ANDROID_HOME &&
      path.join(process.env.ANDROID_HOME, "platform-tools", "adb.exe"),
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, "Android", "Sdk", "platform-tools", "adb.exe"),
    "C:\\tmp\\android-platform-tools\\platform-tools\\adb.exe",
  ];
}

function parseDevices(output) {
  return output
    .split(/\r?\n/u)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state, ...details] = line.split(/\s+/u);
      return { serial, state, details: details.join(" ") };
    });
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
}

const adbPath = existingFile(adbCandidates());
const artifactPath = process.env.MOB13_APK_PATH
  ? path.resolve(process.env.MOB13_APK_PATH)
  : null;
const artifactExists = Boolean(artifactPath && fs.existsSync(artifactPath));
const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
const sourceCommit = run("git", ["rev-parse", "HEAD"]);

let adbResult = { ok: false, output: "ADB executable not found." };
let devices = [];
if (adbPath) {
  adbResult = run(adbPath, ["devices", "-l"]);
  if (adbResult.ok) devices = parseDevices(adbResult.output);
}

const connectedDevices = devices.filter((device) => device.state === "device");
const preflightBlockers = [];
if (!adbPath) preflightBlockers.push("ADB_NOT_FOUND");
else if (!adbResult.ok) preflightBlockers.push("ADB_UNAVAILABLE");
if (connectedDevices.length === 0) preflightBlockers.push("NO_AUTHORIZED_ANDROID_DEVICE");
if (!artifactExists) preflightBlockers.push("APK_ARTIFACT_NOT_PROVIDED");
const certificationBlockers =
  evidence.status === "PASS" ? [] : ["PHYSICAL_EVIDENCE_INCOMPLETE"];

const report = {
  schemaVersion: 1,
  campaign: "MOB-13 Slice 14 physical Android UI certification",
  generatedAt: new Date().toISOString(),
  sourceCommit: sourceCommit.ok ? sourceCommit.output : null,
  campaignReadiness:
    preflightBlockers.length === 0 ? "READY_TO_RUN" : "BLOCKED",
  preflightBlockers,
  adb: {
    path: adbPath,
    commandStatus: adbResult.ok ? "PASS" : "BLOCKED",
    detail: adbResult.ok ? null : adbResult.output,
  },
  devices,
  artifact: artifactExists
    ? { path: artifactPath, sha256: sha256(artifactPath) }
    : { path: artifactPath, sha256: null },
  certificationStatus: evidence.status,
  certificationBlockers,
  certificationEvidence: false,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.campaignReadiness !== "READY_TO_RUN" && !process.argv.includes("--allow-blocked")) {
  process.stderr.write(
    "MOB_13_SLICE_14_BLOCKED: connect an authorized device, provide MOB13_APK_PATH, and complete the recorded physical campaign.\n",
  );
  process.exitCode = 1;
}
