import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const discoveryDisabled = process.env.PHASE_G4_DISABLE_TOOL_DISCOVERY === "1";

function firstExisting(candidates) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) ?? null;
}

function run(file, args, timeout = 10_000) {
  try {
    return {
      ok: true,
      output: execFileSync(file, args, {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout,
      }).trim(),
    };
  } catch (error) {
    return { ok: false, output: String(error.stderr ?? error.message).trim() };
  }
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
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

function inspectArtifact(value, aapt, java, apksignerJar) {
  const resolved = value ? path.resolve(value) : null;
  if (!resolved || !fs.existsSync(resolved)) return { path: resolved, exists: false };

  const result = {
    path: resolved,
    exists: true,
    sha256: sha256(resolved),
    packageName: null,
    versionCode: null,
    versionName: null,
    signerSha256: null,
  };

  if (aapt) {
    const badging = run(aapt, ["dump", "badging", resolved]);
    const packageLine = badging.output.split(/\r?\n/u).find((line) => line.startsWith("package:")) ?? "";
    result.packageName = packageLine.match(/name='([^']+)'/u)?.[1] ?? null;
    result.versionCode = Number(packageLine.match(/versionCode='(\d+)'/u)?.[1] ?? NaN);
    if (!Number.isFinite(result.versionCode)) result.versionCode = null;
    result.versionName = packageLine.match(/versionName='([^']+)'/u)?.[1] ?? null;
  }

  if (java && apksignerJar) {
    const signing = run(java, ["-jar", apksignerJar, "verify", "--print-certs", resolved], 30_000);
    result.signerSha256 = signing.output.match(/Signer #1 certificate SHA-256 digest:\s*([a-f0-9]+)/iu)?.[1]?.toUpperCase() ?? null;
  }

  return result;
}

const defaults = discoveryDisabled ? [] : [
  "C:\\tmp\\android-platform-tools\\platform-tools\\adb.exe",
];
const adb = firstExisting([process.env.PHASE_G4_ADB_PATH, ...defaults]);
const aapt = firstExisting([
  process.env.PHASE_G4_AAPT_PATH,
  ...(discoveryDisabled ? [] : ["C:\\tmp\\tindio-android-sdk\\build-tools\\36.0.0\\aapt.exe"]),
]);
const java = firstExisting([
  process.env.PHASE_G4_JAVA_PATH,
  ...(discoveryDisabled ? [] : ["C:\\tmp\\tindio-jdk17\\jdk-17.0.20.1+1\\bin\\java.exe"]),
]);
const apksignerJar = firstExisting([
  process.env.PHASE_G4_APKSIGNER_JAR,
  ...(discoveryDisabled ? [] : ["C:\\tmp\\tindio-android-sdk\\build-tools\\36.0.0\\lib\\apksigner.jar"]),
]);

const oldClient = inspectArtifact(process.env.PHASE_G4_OLD_CLIENT_APK, aapt, java, apksignerJar);
const releaseCandidate = inspectArtifact(process.env.PHASE_G4_RELEASE_CANDIDATE_APK, aapt, java, apksignerJar);
const adbResult = adb ? run(adb, ["devices", "-l"]) : { ok: false, output: "ADB executable not found." };
const devices = adbResult.ok ? parseDevices(adbResult.output) : [];
const authorizedDevices = devices.filter((device) => device.state === "device");
const blockers = [];

if (!adb) blockers.push("ADB_NOT_FOUND");
else if (!adbResult.ok) blockers.push("ADB_UNAVAILABLE");
if (authorizedDevices.length === 0) blockers.push("NO_AUTHORIZED_ANDROID_DEVICE");
if (!aapt) blockers.push("AAPT_NOT_FOUND");
if (!java || !apksignerJar) blockers.push("APKSIGNER_NOT_FOUND");
if (!oldClient.exists) blockers.push("OLD_CLIENT_APK_NOT_PROVIDED");
if (!releaseCandidate.exists) blockers.push("RELEASE_CANDIDATE_APK_NOT_PROVIDED");

if (oldClient.exists && releaseCandidate.exists) {
  if (!oldClient.packageName || !releaseCandidate.packageName) blockers.push("APK_IDENTITY_UNVERIFIED");
  else if (oldClient.packageName !== releaseCandidate.packageName) blockers.push("PACKAGE_NAME_MISMATCH");

  if (!oldClient.signerSha256 || !releaseCandidate.signerSha256) blockers.push("APK_SIGNER_UNVERIFIED");
  else if (oldClient.signerSha256 !== releaseCandidate.signerSha256) blockers.push("APK_SIGNER_MISMATCH");

  if (oldClient.sha256 === releaseCandidate.sha256) blockers.push("ARTIFACTS_IDENTICAL");
  if (oldClient.versionCode === null || releaseCandidate.versionCode === null) blockers.push("VERSION_CODE_UNVERIFIED");
  else if (releaseCandidate.versionCode <= oldClient.versionCode) blockers.push("RELEASE_CANDIDATE_VERSION_NOT_GREATER_THAN_OLD_CLIENT");
}

const report = {
  schemaVersion: 1,
  campaign: "Phase G4 signed-client release compatibility",
  generatedAt: new Date().toISOString(),
  sourceCommit: run("git", ["rev-parse", "HEAD"]).output || null,
  readiness: blockers.length === 0 ? "READY_FOR_APPROVED_EXECUTION" : "BLOCKED",
  certificationEvidence: false,
  blockers,
  tools: {
    adb,
    aapt,
    java,
    apksignerJar,
  },
  devices,
  oldClient,
  releaseCandidate,
  requiredCampaignLegs: [
    "fresh_install",
    "supported_old_client",
    "forced_upgrade_426",
    "same_signer_in_place_upgrade",
    "provider_rollback",
  ],
  destructiveApprovalRequired: true,
  destructiveReason: "A fresh-install campaign on the current package removes its application data. Use a disposable device/emulator or obtain explicit approval for the exact physical-device reset.",
  productionChangesMade: false,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.readiness !== "READY_FOR_APPROVED_EXECUTION" && !process.argv.includes("--allow-blocked")) {
  process.stderr.write(`PHASE_G4_BLOCKED: ${blockers.join(", ")}\n`);
  process.exitCode = 1;
}
