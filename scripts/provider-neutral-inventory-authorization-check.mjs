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
  "has_inventory_capability",
  "has_all_inventory_capabilities",
  "has_any_inventory_capability",
  "has_organization_store_scope",
  "has_store_read_scope",
  "inventory_actor",
  "has_purchase_order_read_scope",
  "has_stock_transfer_read_scope",
  "has_stock_request_read_scope",
  "can_access_employee_store_scope",
];

const IDENTITY_RESOLVERS = new Set([
  "has_inventory_capability",
  "has_organization_store_scope",
  "has_store_read_scope",
  "inventory_actor",
]);

function escapeRegExp(value) {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
}

function findFunctionDefinitions(
  source,
  functionName,
  migration,
) {
  const escaped = escapeRegExp(functionName);

  const startPattern = new RegExp(
    String.raw`create\s+or\s+replace\s+function\s+private\.${escaped}\s*\(`,
    "gi",
  );

  const definitions = [];

  for (const match of source.matchAll(startPattern)) {
    const start = match.index ?? 0;
    const remainder = source.slice(start);

    const asMatch =
      /\bas\s+(\$[A-Za-z0-9_]*\$)/i.exec(
        remainder,
      );

    if (!asMatch) {
      continue;
    }

    const delimiter = asMatch[1];

    const bodyStart =
      start
      + (asMatch.index ?? 0)
      + asMatch[0].length;

    const bodyEnd = source.indexOf(
      delimiter,
      bodyStart,
    );

    if (bodyEnd === -1) {
      continue;
    }

    const afterClosing =
      bodyEnd + delimiter.length;

    const semicolon = source.indexOf(
      ";",
      afterClosing,
    );

    const end =
      semicolon === -1
        ? afterClosing
        : semicolon + 1;

    definitions.push({
      migration,
      start,
      definition: source.slice(
        start,
        end,
      ),
    });
  }

  return definitions;
}

function containsDirectAuthUid(definition) {
  return /\bauth\.uid\s*\(\s*\)/i.test(
    definition,
  );
}

function containsCurrentProfileId(
  definition,
) {
  return (
    /\bprivate\.current_profile_id\s*\(\s*\)/i
      .test(definition)
  );
}

function containsCurrentIdentitySubject(
  definition,
) {
  return (
    /\bprivate\.current_identity_subject\s*\(\s*\)/i
      .test(definition)
  );
}

function classify(
  functionName,
  definition,
) {
  if (IDENTITY_RESOLVERS.has(functionName)) {
    return "IDENTITY_RESOLVER";
  }

  if (
    /\bprivate\.has_inventory_capability\s*\(/i
      .test(definition)
    || /\bprivate\.has_permission\s*\(/i
      .test(definition)
    || /\bprivate\.has_store_read_scope\s*\(/i
      .test(definition)
    || /\bprivate\.current_employee_id\s*\(/i
      .test(definition)
  ) {
    return "DELEGATING_HELPER";
  }

  return "IDENTITY_NEUTRAL";
}

const entries = (
  await readdir(
    MIGRATIONS_ROOT,
    {
      withFileTypes: true,
    },
  )
)
  .filter(
    (entry) =>
      entry.isFile()
      && entry.name.endsWith(".sql"),
  )
  .map((entry) => entry.name)
  .sort((a, b) =>
    a.localeCompare(b),
  );

const definitionsByFunction =
  new Map(
    TARGET_FUNCTIONS.map(
      (name) => [name, []],
    ),
  );

for (const migration of entries) {
  const source = await readFile(
    path.join(
      MIGRATIONS_ROOT,
      migration,
    ),
    "utf8",
  );

  for (
    const functionName
    of TARGET_FUNCTIONS
  ) {
    const definitions =
      findFunctionDefinitions(
        source,
        functionName,
        migration,
      );

    definitionsByFunction
      .get(functionName)
      .push(...definitions);
  }
}

console.log(
  "PROVIDER-NEUTRAL INVENTORY AUTHORIZATION AUDIT",
);

console.log(
  "----------------------------------------------",
);

let failed = false;
let affected = 0;

for (
  const functionName
  of TARGET_FUNCTIONS
) {
  const definitions =
    definitionsByFunction.get(
      functionName,
    );

  if (
    !definitions
    || definitions.length === 0
  ) {
    console.log("");
    console.log(
      `private.${functionName}`,
    );

    console.log(
      "  winning migration: NOT FOUND",
    );

    console.log(
      "  status: INFORMATIONAL",
    );

    continue;
  }

  const winning =
    definitions[
      definitions.length - 1
    ];

  const classification = classify(
    functionName,
    winning.definition,
  );

  const directAuthUid =
    containsDirectAuthUid(
      winning.definition,
    );

  const currentProfileId =
    containsCurrentProfileId(
      winning.definition,
    );

  const currentIdentitySubject =
    containsCurrentIdentitySubject(
      winning.definition,
    );

  const reasons = [];

  /*
   * No business authorization helper in this audited surface
   * should know Supabase's auth.uid() directly.
   *
   * Provider-specific subject resolution belongs only inside
   * private.current_identity_subject().
   */
  if (directAuthUid) {
    reasons.push(
      "direct provider auth.uid() dependency",
    );
  }

  if (currentIdentitySubject) {
    reasons.push(
      "business helper depends directly on provider subject",
    );
  }

  if (
    classification ===
      "IDENTITY_RESOLVER"
    && !currentProfileId
  ) {
    reasons.push(
      "identity resolver does not use current_profile_id()",
    );
  }

  const status =
    reasons.length === 0
      ? "PASS"
      : "FAIL";

  if (status === "FAIL") {
    failed = true;
    affected += 1;
  }

  console.log("");
  console.log(
    `private.${functionName}`,
  );

  console.log(
    `  winning migration: ${winning.migration}`,
  );

  console.log(
    `  definitions found: ${definitions.length}`,
  );

  console.log(
    `  classification: ${classification}`,
  );

  console.log(
    `  current_profile_id: ${
      currentProfileId
        ? "YES"
        : "NO"
    }`,
  );

  console.log(
    `  direct auth.uid: ${
      directAuthUid
        ? "YES"
        : "NO"
    }`,
  );

  console.log(
    `  current_identity_subject: ${
      currentIdentitySubject
        ? "YES"
        : "NO"
    }`,
  );

  console.log(
    `  status: ${status}`,
  );

  for (const reason of reasons) {
    console.log(
      `  reason: ${reason}`,
    );
  }
}

console.log("");

console.log(
  `affected winning authorization helpers: ${affected}`,
);

if (failed) {
  console.error("");

  console.error(
    "FAIL: provider-neutral inventory authorization is incomplete.",
  );

  console.error(
    "Do not modify historical migrations.",
  );

  console.error(
    "Use a forward-only authorization migration.",
  );

  process.exit(1);
}

console.log("PASS");
