import { readLocalMetadata, writeLocalMetadata } from "../../db/database";

const STORAGE_KEY = "production_crash_state";

export type ProductionCrashState = {
  count: number;
  windowStartedAt: string;
  lastCrashAt: string | null;
};

function createState(): ProductionCrashState {
  return { count: 0, windowStartedAt: new Date().toISOString(), lastCrashAt: null };
}

export async function readProductionCrashState(): Promise<ProductionCrashState> {
  const row = await readLocalMetadata(STORAGE_KEY);
  if (!row) return createState();
  try {
    const parsed = JSON.parse(row.value) as Partial<ProductionCrashState>;
    if (typeof parsed.count !== "number" || !Number.isInteger(parsed.count) || parsed.count < 0 || typeof parsed.windowStartedAt !== "string") return createState();
    return { count: parsed.count, windowStartedAt: parsed.windowStartedAt, lastCrashAt: typeof parsed.lastCrashAt === "string" ? parsed.lastCrashAt : null };
  } catch {
    return createState();
  }
}

export async function recordProductionCrash() {
  const current = await readProductionCrashState();
  const next: ProductionCrashState = { count: current.count + 1, windowStartedAt: current.windowStartedAt, lastCrashAt: new Date().toISOString() };
  await writeLocalMetadata(STORAGE_KEY, JSON.stringify(next));
  return next;
}
