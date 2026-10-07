import { getTindioDatabase } from "../../db/database";

export type TransactionCustodySummary = {
  unresolved: number;
  localPending: number;
  syncing: number;
  conflict: number;
  failed: number;
  onlineCheckoutIntents: number;
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

  const onlineCheckoutRow = organizationId
    ? await database.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) AS count FROM checkout_intents WHERE organization_id=? AND state IN ('PREPARED','SUBMITTING','UNKNOWN')",
        organizationId,
      )
    : await database.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) AS count FROM checkout_intents WHERE state IN ('PREPARED','SUBMITTING','UNKNOWN')",
      );

  const organizations = organizationId
    ? [{ organization_id: organizationId }]
    : await database.getAllAsync<{ organization_id: string }>(
        "SELECT organization_id FROM outbox_events WHERE state<>'SYNCED' UNION SELECT organization_id FROM checkout_intents WHERE state IN ('PREPARED','SUBMITTING','UNKNOWN')",
      );

  const counts = Object.fromEntries(
    rows.map((row) => [row.state, row.count]),
  );

  const localPending = counts.LOCAL_PENDING ?? 0;
  const syncing = counts.SYNCING ?? 0;
  const conflict = counts.CONFLICT ?? 0;
  const failed = counts.FAILED ?? 0;
  const onlineCheckoutIntents = onlineCheckoutRow?.count ?? 0;

  return {
    unresolved:
      localPending + syncing + conflict + failed + onlineCheckoutIntents,
    localPending,
    syncing,
    conflict,
    failed,
    onlineCheckoutIntents,
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
