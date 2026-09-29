import { getTindioDatabase } from "../../db/database";

export type TransactionCustodySummary = {
  unresolved: number;
  localPending: number;
  syncing: number;
  conflict: number;
  failed: number;
  organizationCount: number;
};

type CountRow = {
  state: string;
  count: number;
};

export async function getTransactionCustodySummary(
  organizationId?: string,
): Promise<TransactionCustodySummary> {
  const database = await getTindioDatabase();

  const rows = organizationId
    ? await database.getAllAsync<CountRow>(
        "SELECT state,COUNT(*) AS count FROM outbox_events WHERE organization_id=? AND state<>'SYNCED' GROUP BY state",
        organizationId,
      )
    : await database.getAllAsync<CountRow>(
        "SELECT state,COUNT(*) AS count FROM outbox_events WHERE state<>'SYNCED' GROUP BY state",
      );

  const organizations = organizationId
    ? [{ organization_id: organizationId }]
    : await database.getAllAsync<{ organization_id: string }>(
        "SELECT DISTINCT organization_id FROM outbox_events WHERE state<>'SYNCED'",
      );

  const counts = Object.fromEntries(
    rows.map((row) => [row.state, row.count]),
  );

  const localPending = counts.LOCAL_PENDING ?? 0;
  const syncing = counts.SYNCING ?? 0;
  const conflict = counts.CONFLICT ?? 0;
  const failed = counts.FAILED ?? 0;

  return {
    unresolved:
      localPending + syncing + conflict + failed,
    localPending,
    syncing,
    conflict,
    failed,
    organizationCount: organizations.length,
  };
}

export async function canReleaseTransactionCustody(
  organizationId?: string,
) {
  const summary =
    await getTransactionCustodySummary(
      organizationId,
    );

  if (summary.unresolved > 0) {
    return {
      ok: false as const,
      summary,
      message:
        `TINDIO is protecting ${summary.unresolved} unresolved transaction(s). Synchronize or resolve them before leaving this transaction custody.`,
    };
  }

  return {
    ok: true as const,
    summary,
  };
}
