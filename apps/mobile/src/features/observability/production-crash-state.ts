import { readLocalMetadata, writeLocalMetadata } from "../../db/database";

const STORAGE_KEY = "production_crash_state";

export type ProductionCrashState = {
  count: number;
  windowStartedAt: string;
  lastCrashAt: string | null;
  anrCount: number;
  lastAnrAt: string | null;
};

function createState(): ProductionCrashState {
  return { count: 0, windowStartedAt: new Date().toISOString(), lastCrashAt: null, anrCount: 0, lastAnrAt: null };
}

export async function readProductionCrashState(): Promise<ProductionCrashState> {
  const row = await readLocalMetadata(STORAGE_KEY);
  if (!row) return createState();
  try {
    const parsed = JSON.parse(row.value) as Partial<ProductionCrashState>;
    if (typeof parsed.count !== "number" || !Number.isInteger(parsed.count) || parsed.count < 0 || typeof parsed.windowStartedAt !== "string") return createState();
    return {
      count: parsed.count,
      windowStartedAt: parsed.windowStartedAt,
      lastCrashAt: typeof parsed.lastCrashAt === "string" ? parsed.lastCrashAt : null,
      anrCount: typeof parsed.anrCount === "number" && Number.isInteger(parsed.anrCount) && parsed.anrCount >= 0 ? parsed.anrCount : 0,
      lastAnrAt: typeof parsed.lastAnrAt === "string" ? parsed.lastAnrAt : null,
    };
  } catch {
    return createState();
  }
}

export async function recordProductionCrash() {
  const current = await readProductionCrashState();
  const next: ProductionCrashState = { ...current, count: current.count + 1, lastCrashAt: new Date().toISOString() };
  await writeLocalMetadata(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export async function recordProductionAnr() {
  const current = await readProductionCrashState();
  const next: ProductionCrashState = { ...current, anrCount: current.anrCount + 1, lastAnrAt: new Date().toISOString() };
  await writeLocalMetadata(STORAGE_KEY, JSON.stringify(next));
  return next;
}
