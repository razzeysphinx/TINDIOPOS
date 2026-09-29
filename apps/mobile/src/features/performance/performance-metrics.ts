type SqliteMetricKind =
  | "CATALOG_SEARCH"
  | "BARCODE_LOOKUP"
  | "SKU_LOOKUP";

type State = {
  windowStartedAt: number;

  apiCalls: number;
  apiRetries: number;
  apiFailures: number;
  apiDurationMsTotal: number;
  apiDurationMsMax: number;
  apiResponseBytes: number;

  sqliteQueries: number;
  sqliteDurationMsTotal: number;
  sqliteDurationMsMax: number;
  sqliteRowsReturned: number;

  catalogSearchQueries: number;
  barcodeLookupQueries: number;
  skuLookupQueries: number;

  syncRuns: number;
  syncDurationMsTotal: number;
  syncDurationMsMax: number;
  syncOutboxAcked: number;
  syncPullPages: number;
  syncCatalogProducts: number;
  syncCustomers: number;

  recoveryRuns: number;
  recoveryDurationMsTotal: number;
  recoveryDurationMsMax: number;
};

function createState(): State {
  return {
    windowStartedAt:
      Date.now(),

    apiCalls: 0,
    apiRetries: 0,
    apiFailures: 0,
    apiDurationMsTotal: 0,
    apiDurationMsMax: 0,
    apiResponseBytes: 0,

    sqliteQueries: 0,
    sqliteDurationMsTotal: 0,
    sqliteDurationMsMax: 0,
    sqliteRowsReturned: 0,

    catalogSearchQueries: 0,
    barcodeLookupQueries: 0,
    skuLookupQueries: 0,

    syncRuns: 0,
    syncDurationMsTotal: 0,
    syncDurationMsMax: 0,
    syncOutboxAcked: 0,
    syncPullPages: 0,
    syncCatalogProducts: 0,
    syncCustomers: 0,

    recoveryRuns: 0,
    recoveryDurationMsTotal: 0,
    recoveryDurationMsMax: 0,
  };
}

let state = createState();

export function resetPerformanceMetrics() {
  state = createState();
}

export function recordApiCall(input: {
  durationMs: number;
  responseBytes: number;
  retried: boolean;
  failed: boolean;
}) {
  state.apiCalls += 1;

  if (input.retried) {
    state.apiRetries += 1;
  }

  if (input.failed) {
    state.apiFailures += 1;
  }

  state.apiDurationMsTotal +=
    input.durationMs;

  state.apiDurationMsMax =
    Math.max(
      state.apiDurationMsMax,
      input.durationMs,
    );

  state.apiResponseBytes +=
    Math.max(
      0,
      input.responseBytes,
    );
}

export function recordSqliteQuery(input: {
  kind: SqliteMetricKind;
  durationMs: number;
  rowsReturned: number;
}) {
  state.sqliteQueries += 1;

  state.sqliteDurationMsTotal +=
    input.durationMs;

  state.sqliteDurationMsMax =
    Math.max(
      state.sqliteDurationMsMax,
      input.durationMs,
    );

  state.sqliteRowsReturned +=
    Math.max(
      0,
      input.rowsReturned,
    );

  if (
    input.kind
    === "CATALOG_SEARCH"
  ) {
    state.catalogSearchQueries += 1;
  }

  if (
    input.kind
    === "BARCODE_LOOKUP"
  ) {
    state.barcodeLookupQueries += 1;
  }

  if (
    input.kind
    === "SKU_LOOKUP"
  ) {
    state.skuLookupQueries += 1;
  }
}

export function recordSyncRun(input: {
  durationMs: number;
  outboxAcked: number;
  pullPages: number;
  catalogProducts: number;
  customers: number;
}) {
  state.syncRuns += 1;

  state.syncDurationMsTotal +=
    input.durationMs;

  state.syncDurationMsMax =
    Math.max(
      state.syncDurationMsMax,
      input.durationMs,
    );

  state.syncOutboxAcked +=
    input.outboxAcked;

  state.syncPullPages +=
    input.pullPages;

  state.syncCatalogProducts +=
    input.catalogProducts;

  state.syncCustomers +=
    input.customers;
}

export function recordRecoveryRun(
  durationMs: number,
) {
  state.recoveryRuns += 1;

  state.recoveryDurationMsTotal +=
    durationMs;

  state.recoveryDurationMsMax =
    Math.max(
      state.recoveryDurationMsMax,
      durationMs,
    );
}

function average(
  total: number,
  count: number,
) {
  return count > 0
    ? total / count
    : 0;
}

export function getPerformanceMetrics() {
  const elapsedMs =
    Math.max(
      1,
      Date.now()
      - state.windowStartedAt,
    );

  const elapsedHours =
    elapsedMs
    / 3_600_000;

  const apiCallsPerHour =
    elapsedMs >= 60_000
      ? state.apiCalls
        / elapsedHours
      : null;

  const syncProcessedRecords =
    state.syncOutboxAcked
    + state.syncCatalogProducts
    + state.syncCustomers;

  const syncThroughputPerSecond =
    state.syncDurationMsTotal > 0
      ? syncProcessedRecords
        / (
          state.syncDurationMsTotal
          / 1000
        )
      : 0;

  return {
    windowStartedAt:
      new Date(
        state.windowStartedAt,
      ).toISOString(),

    elapsedMs,

    apiCalls:
      state.apiCalls,

    apiCallsPerHour,

    apiRetries:
      state.apiRetries,

    apiFailures:
      state.apiFailures,

    apiAverageLatencyMs:
      average(
        state.apiDurationMsTotal,
        state.apiCalls,
      ),

    apiMaxLatencyMs:
      state.apiDurationMsMax,

    apiResponseBytes:
      state.apiResponseBytes,

    sqliteQueries:
      state.sqliteQueries,

    sqliteAverageLatencyMs:
      average(
        state.sqliteDurationMsTotal,
        state.sqliteQueries,
      ),

    sqliteMaxLatencyMs:
      state.sqliteDurationMsMax,

    sqliteRowsReturned:
      state.sqliteRowsReturned,

    catalogSearchQueries:
      state.catalogSearchQueries,

    barcodeLookupQueries:
      state.barcodeLookupQueries,

    skuLookupQueries:
      state.skuLookupQueries,

    syncRuns:
      state.syncRuns,

    syncAverageDurationMs:
      average(
        state.syncDurationMsTotal,
        state.syncRuns,
      ),

    syncMaxDurationMs:
      state.syncDurationMsMax,

    syncOutboxAcked:
      state.syncOutboxAcked,

    syncPullPages:
      state.syncPullPages,

    syncCatalogProducts:
      state.syncCatalogProducts,

    syncCustomers:
      state.syncCustomers,

    syncThroughputPerSecond,

    recoveryRuns:
      state.recoveryRuns,

    recoveryAverageDurationMs:
      average(
        state.recoveryDurationMsTotal,
        state.recoveryRuns,
      ),

    recoveryMaxDurationMs:
      state.recoveryDurationMsMax,

    realtimeConnections: 0,
  };
}