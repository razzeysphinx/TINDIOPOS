import { readLocalMetadata, writeLocalMetadata } from "../../db/database";
import { getHistoricalAndroidExitEvents } from "../../../modules/tindio-exit-observer";
import { reconcileAndroidExitEvents } from "./android-exit-reconciliation";

const STORAGE_KEY = "production_crash_state";

export type ProductionCrashState = {
  count: number;
  windowStartedAt: string;
  lastCrashAt: string | null;
  anrCount: number;
  lastAnrAt: string | null;
  lastProcessedAndroidExitAtMs: number;
  androidExitHistoryInitialized: boolean;
  processedAndroidExitFingerprints: string[];
};

function createState(): ProductionCrashState {
  return {
    count: 0,
    windowStartedAt: new Date().toISOString(),
    lastCrashAt: null,
    anrCount: 0,
    lastAnrAt: null,
    lastProcessedAndroidExitAtMs: 0,
    androidExitHistoryInitialized: false,
    processedAndroidExitFingerprints: [],
  };
}

let pendingMutation: Promise<unknown> = Promise.resolve();

function mutateProductionCrashState(update: (current: ProductionCrashState) => ProductionCrashState) {
  const result = pendingMutation.then(async () => {
    const current = await readProductionCrashState();
    const next = update(current);
    if (next === current) return current;
    await writeLocalMetadata(STORAGE_KEY, JSON.stringify(next));
    return next;
  });
  pendingMutation = result.catch(() => undefined);
  return result;
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
      lastProcessedAndroidExitAtMs: typeof parsed.lastProcessedAndroidExitAtMs === "number" && Number.isSafeInteger(parsed.lastProcessedAndroidExitAtMs) && parsed.lastProcessedAndroidExitAtMs >= 0 ? parsed.lastProcessedAndroidExitAtMs : 0,
      androidExitHistoryInitialized: parsed.androidExitHistoryInitialized === true,
      processedAndroidExitFingerprints: Array.isArray(parsed.processedAndroidExitFingerprints)
        ? parsed.processedAndroidExitFingerprints.filter((value): value is string => typeof value === "string").slice(-64)
        : [],
    };
  } catch {
    return createState();
  }
}

export async function recordProductionCrash() {
  return mutateProductionCrashState((current) => ({ ...current, count: current.count + 1, lastCrashAt: new Date().toISOString() }));
}

export async function recordProductionAnr() {
  return mutateProductionCrashState((current) => ({ ...current, anrCount: current.anrCount + 1, lastAnrAt: new Date().toISOString() }));
}

export async function reconcileAndroidProcessExitHistory() {
  const events = await getHistoricalAndroidExitEvents();
  return mutateProductionCrashState((current) => reconcileAndroidExitEvents(current, events));
}
