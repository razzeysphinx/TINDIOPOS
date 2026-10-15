export type ReconciledAndroidExitEvent = {
  type: "NATIVE_CRASH" | "JAVA_CRASH" | "ANR";
  timestampMs: number;
};

export type AndroidExitAggregateState = {
  count: number;
  lastCrashAt: string | null;
  anrCount: number;
  lastAnrAt: string | null;
  lastProcessedAndroidExitAtMs: number;
  androidExitHistoryInitialized: boolean;
  processedAndroidExitFingerprints: string[];
};

const MAX_PROCESSED_ANDROID_EXITS = 64;
const VALID_TYPES = new Set<ReconciledAndroidExitEvent["type"]>([
  "NATIVE_CRASH",
  "JAVA_CRASH",
  "ANR",
]);

function validEvent(event: ReconciledAndroidExitEvent) {
  return VALID_TYPES.has(event.type)
    && Number.isSafeInteger(event.timestampMs)
    && event.timestampMs > 0;
}

function fingerprint(event: ReconciledAndroidExitEvent) {
  return `${event.type}:${event.timestampMs}`;
}

export function reconcileAndroidExitEvents<T extends AndroidExitAggregateState>(
  current: T,
  candidates: ReconciledAndroidExitEvent[],
): T {
  const batchFingerprints = new Set<string>();
  const events = candidates
    .filter(validEvent)
    .sort((left, right) => left.timestampMs - right.timestampMs)
    .filter((event) => {
      const value = fingerprint(event);
      if (batchFingerprints.has(value)) return false;
      batchFingerprints.add(value);
      return true;
    });
  if (events.length === 0) return current;
  const known = new Set(current.processedAndroidExitFingerprints);
  const legacyMigration = !current.androidExitHistoryInitialized;
  const unseen = events.filter((event) => {
    if (known.has(fingerprint(event))) return false;
    return legacyMigration ? event.timestampMs > current.lastProcessedAndroidExitAtMs : true;
  });

  let count = current.count;
  let anrCount = current.anrCount;
  let lastCrashAt = current.lastCrashAt;
  let lastAnrAt = current.lastAnrAt;
  for (const event of unseen) {
    const occurredAt = new Date(event.timestampMs).toISOString();
    if (event.type === "ANR") {
      anrCount += 1;
      lastAnrAt = occurredAt;
    } else {
      count += 1;
      lastCrashAt = occurredAt;
    }
  }

  const processedAndroidExitFingerprints = [
    ...current.processedAndroidExitFingerprints,
    ...events.map(fingerprint),
  ].filter((value, index, all) => all.indexOf(value) === index)
    .slice(-MAX_PROCESSED_ANDROID_EXITS);
  const lastProcessedAndroidExitAtMs = Math.max(
    current.lastProcessedAndroidExitAtMs,
    ...events.map((event) => event.timestampMs),
  );

  if (
    current.androidExitHistoryInitialized
    && unseen.length === 0
    && lastProcessedAndroidExitAtMs === current.lastProcessedAndroidExitAtMs
    && processedAndroidExitFingerprints.length === current.processedAndroidExitFingerprints.length
  ) {
    return current;
  }

  return {
    ...current,
    count,
    anrCount,
    lastCrashAt,
    lastAnrAt,
    lastProcessedAndroidExitAtMs,
    androidExitHistoryInitialized: true,
    processedAndroidExitFingerprints,
  };
}
