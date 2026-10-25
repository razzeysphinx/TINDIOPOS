import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function firstExisting(candidates) {
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
    return { ok: false, output: String(error.stderr ?? error.message).trim() };
  }
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

function artifact(value) {
  const resolved = value ? path.resolve(value) : null;
  if (!resolved || !fs.existsSync(resolved)) return { path: resolved, sha256: null };
  return {
    path: resolved,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(resolved)).digest("hex").toUpperCase(),
  };
}

const adb = firstExisting([
  process.env.PHASE_G_ADB_PATH,
  process.env.ANDROID_SDK_ROOT && path.join(process.env.ANDROID_SDK_ROOT, "platform-tools", "adb.exe"),
  process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, "platform-tools", "adb.exe"),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Android", "Sdk", "platform-tools", "adb.exe"),
  "C:\\tmp\\android-platform-tools\\platform-tools\\adb.exe",
]);
const baseline = artifact(process.env.PHASE_G_BASELINE_APK);
const successor = artifact(process.env.PHASE_G_SUCCESSOR_APK);
const adbResult = adb ? run(adb, ["devices", "-l"]) : { ok: false, output: "ADB executable not found." };
const devices = adbResult.ok ? parseDevices(adbResult.output) : [];
const authorizedDevices = devices.filter((device) => device.state === "device");
const blockers = [];
if (!adb) blockers.push("ADB_NOT_FOUND");
else if (!adbResult.ok) blockers.push("ADB_UNAVAILABLE");
if (authorizedDevices.length === 0) blockers.push("NO_AUTHORIZED_ANDROID_DEVICE");
if (!baseline.sha256) blockers.push("PHASE_G_BASELINE_APK_NOT_PROVIDED");
if (!successor.sha256) blockers.push("PHASE_G_SUCCESSOR_APK_NOT_PROVIDED");

const report = {
  schemaVersion: 1,
  campaign: "Phase G3 physical Auth and offline-custody in-place upgrade",
  generatedAt: new Date().toISOString(),
  sourceCommit: run("git", ["rev-parse", "HEAD"]).output || null,
  readiness: blockers.length === 0 ? "READY_TO_RUN" : "BLOCKED",
  certificationEvidence: false,
  blockers,
  adb: { path: adb, commandStatus: adbResult.ok ? "PASS" : "BLOCKED" },
  devices,
  baselineArtifact: baseline,
  successorArtifact: successor,
  requiredMethod: "adb install -r",
  destructiveOperationsProhibited: ["adb uninstall", "pm clear", "SQLite reset", "SecureStore clear", "device reenrollment"],
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.readiness !== "READY_TO_RUN" && !process.argv.includes("--allow-blocked")) {
  process.stderr.write("PHASE_G3_BLOCKED: connect an authorized Android device and provide the same-signer baseline and successor APKs.\n");
  process.exitCode = 1;
}
