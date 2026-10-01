import { readFile } from "node:fs/promises";
import { parseAndValidateLocalSupabaseStatus } from "../lib/certification-safety.mjs";
import { runCommand } from "../lib/run-command.mjs";
import { runSql } from "../lib/phase-04-postgres-docker.mjs";

const status = runCommand("pnpm", ["exec", "supabase", "status", "--output", "json"], { cwd: process.cwd(), env: process.env, capture: true });
if (status.error || status.status !== 0) throw new Error("Unable to inspect local Supabase status.");
parseAndValidateLocalSupabaseStatus(status.stdout ?? "");
const db = JSON.parse(status.stdout ?? "{}").DB_URL;
if (typeof db !== "string") throw new Error("Local DB_URL is unavailable.");
for (const path of ["database/migrations/0002_provider_neutral_business_identity.sql", "database/provider/local/01_identity.sql", "database/migrations/0003_provider_neutral_roles_rls.sql", "database/provider/local/00_roles.sql", "database/migrations/0004_inventory_replenishment_read_models.sql", "database/migrations/0005_inventory_core_read_model_extension.sql", "database/migrations/0006_inventory_purchasing_read_model.sql", "database/migrations/0007_inventory_specialized_read_models.sql", "database/migrations/0008_r5_management_catalog_read_models.sql", "database/migrations/0009_r5_pos_reporting_read_models.sql", "database/migrations/0010_r5_residual_read_models.sql"]) runSql(db, await readFile(path, "utf8"));
console.log("TINDIO R5 canonical local chain applied through 0010.");
