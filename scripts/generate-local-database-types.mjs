import { writeFile } from "node:fs/promises";
import process from "node:process";

import { runCommand } from "./lib/run-command.mjs";

const result = runCommand(
  "pnpm",
  [
    "exec",
    "supabase",
    "gen",
    "types",
    "typescript",
    "--local",
  ],
  {
    cwd: process.cwd(),
    env: process.env,
    capture: true,
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  process.exit(result.status ?? 1);
}

const generated = result.stdout ?? "";

if (!generated.includes("export type Database")) {
  console.error(
    "Generated output does not contain the Database type. No file was written.",
  );
  process.exit(1);
}

if (!generated.includes("current_profile_id")) {
  console.error(
    "Local database types do not contain current_profile_id. No file was written.",
  );
  process.exit(1);
}

const output = `${generated.trimEnd()}

// Application convenience alias retained across Supabase CLI type regeneration.
export type TableRow<TableName extends keyof DefaultSchema["Tables"]> =
  Tables<TableName>;
`;

await writeFile(
  new URL(
    "../src/lib/supabase/database.types.ts",
    import.meta.url,
  ),
  output,
  "utf8",
);

console.log(
  "Generated local Supabase database types with current_profile_id.",
);
