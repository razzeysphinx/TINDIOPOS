import {
  spawnSync,
} from "node:child_process";

const tests = [
  "supabase/tests/database/provider_neutral_core_authorization.test.sql",
  "supabase/tests/database/improvement_16_multi_tenant_readiness.test.sql",
  "supabase/tests/database/phase_7_security_boundary_hardening.test.sql",
  "supabase/tests/database/improvement_12_device_register_management.test.sql",
  "supabase/tests/database/improvement_13_offline_sync_foundation.test.sql",
  "supabase/tests/database/owner_store_access_and_self_edit.test.sql",
];

let failed = false;

for (const file of tests) {
  process.stdout.write(
    `\n[PHASE 21] ${file}\n`,
  );

  const result =
    spawnSync(
      "pnpm",
      [
        "exec",
        "supabase",
        "test",
        "db",
        file,
      ],
      {
        encoding: "utf8",
        shell:
          process.platform
            === "win32",
      },
    );

  if (result.stdout) {
    process.stdout.write(
      result.stdout,
    );
  }

  if (result.stderr) {
    process.stderr.write(
      result.stderr,
    );
  }

  if (result.status !== 0) {
    failed = true;
    break;
  }
}

if (failed) {
  process.exitCode = 1;
}