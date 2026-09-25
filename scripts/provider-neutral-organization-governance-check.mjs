import {
  readdir,
  readFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const MIGRATIONS_ROOT = path.join(
  ROOT,
  "supabase",
  "migrations",
);

const TARGET_FUNCTIONS = [
  {
    schema: "private",
    name: "has_organization_export_access",
    identity: "PROFILE",
    capabilities: ["organization.export"],
  },
  {
    schema: "private",
    name: "has_organization_lifecycle_access",
    identity: "PROFILE",
    capabilities: [
      "organization.archive",
      "organization.lifecycle",
    ],
  },
  {
    schema: "private",
    name: "has_organization_recovery_view_access",
    identity: "PROFILE",
    capabilities: [
      "recovery.view",
      "recovery.manage",
    ],
  },
  {
    schema: "private",
    name: "has_organization_recovery_manage_access",
    identity: "PROFILE",
    capabilities: ["recovery.manage"],
  },
  {
    schema: "private",
    name: "current_organization_member_employee_id",
    identity: "PROFILE",
  },
  {
    schema: "private",
    name: "consume_organization_rate_limit",
    identity: "PROFILE",
  },
  {
    schema: "private",
    name: "prepare_organization_export",
    identity: "PROFILE_OR_MEMBER",
  },
  {
    schema: "public",
    name: "get_organization_export_page",
    identity: "PROFILE",
  },
  {
    schema: "private",
    name: "complete_organization_export",
    identity: "PROFILE_OR_MEMBER",
  },
  {
    schema: "private",
    name: "manage_organization_lifecycle",
    identity: "MEMBER",
  },
];

function escapeRegExp(value) {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
}

function findFunctionDefinitions(source, target, migration) {
  const startPattern = new RegExp(
    String.raw`create\s+or\s+replace\s+function\s+${escapeRegExp(target.schema)}\.${escapeRegExp(target.name)}\s*\(`,
    "gi",
  );
  const definitions = [];

  for (const match of source.matchAll(startPattern)) {
    const start = match.index ?? 0;
    const remainder = source.slice(start);
    const asMatch = /\bas\s+(\$[A-Za-z0-9_]*\$)/i.exec(remainder);

    if (!asMatch) {
      continue;
    }

    const delimiter = asMatch[1];
    const bodyStart = start + (asMatch.index ?? 0) + asMatch[0].length;
    const bodyEnd = source.indexOf(delimiter, bodyStart);

    if (bodyEnd === -1) {
      continue;
    }

    const afterClosing = bodyEnd + delimiter.length;
    const semicolon = source.indexOf(";", afterClosing);

    definitions.push({
      migration,
      definition: source.slice(
        start,
        semicolon === -1 ? afterClosing : semicolon + 1,
      ),
    });
  }

  return definitions;
}

function containsCurrentProfileId(definition) {
  return /\bprivate\.current_profile_id\s*\(\s*\)/i.test(definition);
}

function containsMemberHelper(definition) {
  return /\bprivate\.current_organization_member_employee_id\s*\(/i.test(
    definition,
  );
}

function containsDirectProviderIdentity(definition) {
  return /\bauth\.uid\s*\(\s*\)/i.test(definition);
}

function containsRoleNameAuthorization(definition) {
  return /\b(?:lower\s*\(\s*)?role\.name\s*\)?\s*=\s*'owner'/i.test(
    definition,
  );
}

const entries = (
  await readdir(
    MIGRATIONS_ROOT,
    { withFileTypes: true },
  )
)
  .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right));

const definitionsByFunction = new Map(
  TARGET_FUNCTIONS.map((target) => [
    `${target.schema}.${target.name}`,
    [],
  ]),
);

for (const migration of entries) {
  const source = await readFile(
    path.join(MIGRATIONS_ROOT, migration),
    "utf8",
  );

  for (const target of TARGET_FUNCTIONS) {
    definitionsByFunction
      .get(`${target.schema}.${target.name}`)
      .push(...findFunctionDefinitions(source, target, migration));
  }
}

console.log("PROVIDER-NEUTRAL ORGANIZATION GOVERNANCE AUDIT");
console.log("-------------------------------------------------");

let failed = false;
let directProviderDependencies = 0;

for (const target of TARGET_FUNCTIONS) {
  const label = `${target.schema}.${target.name}`;
  const definitions = definitionsByFunction.get(label) ?? [];
  const winning = definitions.at(-1);
  const reasons = [];

  if (!winning) {
    reasons.push("winning function definition not found");
  }

  const definition = winning?.definition ?? "";
  const directProviderIdentity = containsDirectProviderIdentity(definition);
  const currentProfileId = containsCurrentProfileId(definition);
  const memberHelper = containsMemberHelper(definition);
  const roleNameAuthorization = containsRoleNameAuthorization(definition);

  if (directProviderIdentity) {
    directProviderDependencies += 1;
    reasons.push("direct provider auth dependency");
  }

  if (roleNameAuthorization) {
    reasons.push("role-name authorization is not permitted");
  }

  if (
    target.identity === "PROFILE"
    && !currentProfileId
  ) {
    reasons.push("current_profile_id() is required");
  }

  if (
    target.identity === "MEMBER"
    && !memberHelper
  ) {
    reasons.push("current organization member helper is required");
  }

  if (
    target.identity === "PROFILE_OR_MEMBER"
    && !currentProfileId
    && !memberHelper
  ) {
    reasons.push("current_profile_id() or the member helper is required");
  }

  for (const capability of target.capabilities ?? []) {
    if (!definition.includes(`'${capability}'`)) {
      reasons.push(`missing capability ${capability}`);
    }
  }

  const status = reasons.length === 0 ? "PASS" : "FAIL";
  failed ||= status === "FAIL";

  console.log("");
  console.log(label);
  console.log(`  winning migration: ${winning?.migration ?? "NOT FOUND"}`);
  console.log(`  definitions found: ${definitions.length}`);
  console.log(`  current_profile_id: ${currentProfileId ? "YES" : "NO"}`);
  console.log(`  member helper: ${memberHelper ? "YES" : "NO"}`);
  console.log(`  direct auth.uid: ${directProviderIdentity ? "YES" : "NO"}`);
  console.log(`  role-name authorization: ${roleNameAuthorization ? "YES" : "NO"}`);
  console.log(`  status: ${status}`);

  for (const reason of reasons) {
    console.log(`  reason: ${reason}`);
  }
}

console.log("");
console.log(`direct provider auth dependencies: ${directProviderDependencies}`);

if (failed) {
  console.error("FAIL: provider-neutral organization governance is incomplete.");
  console.error("Do not modify historical migrations; use a forward-only repair.");
  process.exit(1);
}

console.log("PASS");
