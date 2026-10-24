import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

function normalizedEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function indexUnique(values, key, issueCode, issues) {
  const index = new Map();
  for (const value of values) {
    const identifier = key(value);
    if (!identifier) continue;
    if (index.has(identifier)) {
      issues.push({ code: issueCode, reference: fingerprint(identifier) });
      index.set(identifier, null);
    } else index.set(identifier, value);
  }
  return index;
}

export function buildIdentityMappingDryRun(input) {
  const supabaseUsers = Array.isArray(input.supabaseUsers) ? input.supabaseUsers : [];
  const neonUsers = Array.isArray(input.neonUsers) ? input.neonUsers : [];
  const profiles = Array.isArray(input.profiles) ? input.profiles : [];
  const identityLinks = Array.isArray(input.identityLinks) ? input.identityLinks : [];
  const issues = [];
  const profileById = indexUnique(profiles, ({ id }) => id, "DUPLICATE_PROFILE_ID", issues);
  const supabaseById = indexUnique(supabaseUsers, ({ id }) => id, "DUPLICATE_SUPABASE_SUBJECT", issues);
  const neonById = indexUnique(neonUsers, ({ id }) => id, "DUPLICATE_NEON_SUBJECT", issues);
  const profilesByEmail = new Map();
  const supabaseByEmail = new Map();
  const neonByEmail = new Map();

  const addEmail = (index, value) => {
    const email = normalizedEmail(value.email);
    if (!email) return;
    const matches = index.get(email) ?? [];
    matches.push(value);
    index.set(email, matches);
  };
  profiles.forEach((value) => addEmail(profilesByEmail, value));
  supabaseUsers.forEach((value) => addEmail(supabaseByEmail, value));
  neonUsers.forEach((value) => addEmail(neonByEmail, value));

  const linksByProviderSubject = new Map();
  const linksByProfile = new Map();
  for (const link of identityLinks) {
    const key = `${link.provider}:${link.providerSubject}`;
    if (linksByProviderSubject.has(key)) {
      issues.push({ code: "DUPLICATE_PROVIDER_SUBJECT", reference: fingerprint(key) });
      continue;
    }
    linksByProviderSubject.set(key, link);
    const profileLinks = linksByProfile.get(link.profileId) ?? [];
    profileLinks.push(link);
    linksByProfile.set(link.profileId, profileLinks);
    if (!profileById.get(link.profileId)) {
      issues.push({ code: "IDENTITY_LINK_PROFILE_MISSING", reference: fingerprint(key) });
    }
  }

  const records = [];
  for (const user of supabaseUsers) {
    const reference = fingerprint(`supabase:${user.id}`);
    const email = normalizedEmail(user.email);
    const existingLink = linksByProviderSubject.get(`supabase:${user.id}`);
    let profile = existingLink ? profileById.get(existingLink.profileId) : null;
    let status = "BLOCKED";
    let reason = "NO_STABLE_PROFILE_MATCH";

    if (existingLink && profile) {
      status = "ACCOUNTED_FOR";
      reason = "EXISTING_SUPABASE_IDENTITY_LINK";
    } else if (!email) {
      reason = "SUPABASE_EMAIL_MISSING";
    } else {
      const matches = profilesByEmail.get(email) ?? [];
      if (matches.length === 1) {
        profile = matches[0];
        status = "REVIEW_REQUIRED";
        reason = "UNLINKED_UNIQUE_EMAIL_CANDIDATE";
      } else if (matches.length > 1) reason = "DUPLICATE_PROFILE_EMAIL";
    }

    const neonMatches = email ? neonByEmail.get(email) ?? [] : [];
    let neonAction = "CREATE_OR_CLAIM_WITH_PASSWORD_RESET";
    if (neonMatches.length === 1 && profile) {
      const neonLink = linksByProviderSubject.get(`neon:${neonMatches[0].id}`);
      if (!neonLink) neonAction = "PROPOSE_LINK_AFTER_OWNER_REVIEW";
      else if (neonLink.profileId === profile.id) neonAction = "ALREADY_LINKED";
      else {
        neonAction = "BLOCKED_CONFLICTING_NEON_LINK";
        status = "BLOCKED";
        reason = "NEON_SUBJECT_LINKS_DIFFERENT_PROFILE";
      }
    } else if (neonMatches.length > 1) {
      neonAction = "BLOCKED_DUPLICATE_NEON_EMAIL";
      status = "BLOCKED";
      reason = "DUPLICATE_NEON_EMAIL";
    }

    records.push({
      reference,
      profileReference: profile ? fingerprint(`profile:${profile.id}`) : null,
      status,
      reason,
      neonAction,
      passwordAction: "RESET_REQUIRED_NO_HASH_MIGRATION",
    });
  }

  for (const profile of profiles) {
    const email = normalizedEmail(profile.email);
    const sourceUsers = email ? supabaseByEmail.get(email) ?? [] : [];
    const links = linksByProfile.get(profile.id) ?? [];
    if (sourceUsers.length === 0 && !links.some(({ provider }) => provider === "supabase")) {
      issues.push({
        code: "PROFILE_WITHOUT_SUPABASE_ACCOUNT",
        reference: fingerprint(`profile:${profile.id}`),
      });
    }
  }

  const counts = records.reduce((result, record) => {
    result[record.status] = (result[record.status] ?? 0) + 1;
    return result;
  }, {});
  return {
    mode: "DRY_RUN_NO_WRITES",
    inputs: {
      supabaseUsers: supabaseById.size,
      neonUsers: neonById.size,
      profiles: profileById.size,
      identityLinks: identityLinks.length,
    },
    counts,
    issueCount: issues.length,
    records,
    issues,
  };
}

async function main() {
  const inputFlag = process.argv.indexOf("--input");
  if (inputFlag < 0 || !process.argv[inputFlag + 1]) {
    throw new Error("Usage: node scripts/phase-f-identity-mapping-dry-run.mjs --input <inventory.json>");
  }
  const input = JSON.parse(await readFile(process.argv[inputFlag + 1], "utf8"));
  process.stdout.write(`${JSON.stringify(buildIdentityMappingDryRun(input), null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
