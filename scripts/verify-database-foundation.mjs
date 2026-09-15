import { spawnSync } from "node:child_process";
import process from "node:process";

const resetLocal = process.argv.includes("--reset-local");

const steps = [
  {
    name: "Rebuild deterministic inventory transfer RBAC migration",
    command: "node",
    args: ["scripts/rebuild-inventory-transfer-rbac.mjs"],
  },
  {
    name: "Inventory granular RBAC structure",
    command: "pnpm",
    args: ["test:inventory-rbac"],
  },
  {
    name: "Inventory purchasing RBAC",
    command: "pnpm",
    args: ["test:inventory-purchasing-rbac"],
  },
  {
    name: "Inventory count stocktake",
    command: "pnpm",
    args: ["test:inventory-count-stocktake"],
  },
  {
    name: "Inventory schema contract",
    command: "pnpm",
    args: ["test:inventory-schema-contract"],
  },
  {
    name: "Database portability inventory",
    command: "node",
    args: ["scripts/database-portability-audit.mjs"],
  },
  {
    name: "Git whitespace validation",
    command: "git",
    args: ["diff", "--check"],
  },
];

if (resetLocal) {
  steps.push(
    {
      name: "LOCAL Supabase database rebuild",
      command: "pnpm",
      args: ["exec", "supabase", "db", "reset", "--local"],
    },
    {
      name: "Inventory transfer chain",
      command: "pnpm",
      args: ["test:inventory-transfers"],
    },
    {
      name: "Inventory transfer and replenishment",
      command: "pnpm",
      args: ["test:inventory-transfers-replenishment"],
    },
    {
      name: "Inventory multi-store",
      command: "pnpm",
      args: ["test:inventory-multi-store"],
    },
    {
      name: "Inventory idempotency recovery",
      command: "pnpm",
      args: ["test:inventory-idempotency-recovery"],
    },
    {
      name: "Inventory ledger integrity",
      command: "pnpm",
      args: ["test:inventory-ledger-integrity"],
    },
    {
      name: "Security boundaries",
      command: "pnpm",
      args: ["test:security-boundaries"],
    },
    {
      name: "Offline integrity",
      command: "pnpm",
      args: ["test:offline-integrity"],
    },
    {
      name: "TypeScript",
      command: "pnpm",
      args: ["typecheck"],
    },
    {
      name: "ESLint",
      command: "pnpm",
      args: ["lint"],
    },
    {
      name: "Production build",
      command: "pnpm",
      args: ["build"],
    },
  );
}

function run(step) {
  console.log(`\n=== ${step.name} ===`);
  console.log(`$ ${step.command} ${step.args.join(" ")}`);

  const result = spawnSync(step.command, step.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`\nFAILED: ${step.name}`);
    console.error("Fix the reported root cause before continuing. No later step was executed.");
    process.exit(result.status ?? 1);
  }
}

console.log("TINDIO database foundation verification");
console.log(`Mode: ${resetLocal ? "LOCAL RESET + FULL VERIFICATION" : "STATIC / NON-DESTRUCTIVE"}`);
if (!resetLocal) {
  console.log("No database reset will be performed. Pass --reset-local only when the target is confirmed local Docker/Supabase.");
}

for (const step of steps) run(step);

console.log("\nTINDIO database foundation verification PASSED.");
if (!resetLocal) {
  console.log("Next, after confirming the database is local, run:");
  console.log("  node scripts/verify-database-foundation.mjs --reset-local");
}
