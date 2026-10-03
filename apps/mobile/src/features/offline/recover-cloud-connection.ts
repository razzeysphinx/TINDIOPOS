import {
  getOutboxSummary,
} from "../../db/outbox";
import {
  reconcileCloud,
} from "../sync/reconcile-cloud";
import {
  synchronizeWithStoreHub,
} from "../store-hub/store-hub-sync";

export type CloudRecoveryResult =
  | {
      ok: true;
      mode: "CLOUD_ONLINE";
      outboxAcked: number;
      pullPages: number;
    }
  | {
      ok: false;
      mode: "RECOVERING" | "SYNC_REVIEW";
      reason: string;
    };

export async function recoverCloudConnection(
  organizationId: string,
): Promise<CloudRecoveryResult> {
  const reconciliation =
    await reconcileCloud(organizationId);

  if (!reconciliation.ok) {
    return {
      ok: false,
      mode:
        reconciliation.reason
        === "OUTBOX_REVIEW_REQUIRED"
          ? "SYNC_REVIEW"
          : "RECOVERING",
      reason:
        reconciliation.reason
        ?? "RECOVERY_INCOMPLETE",
    };
  }

  if (reconciliation.hasMore) {
    return {
      ok: false,
      mode: "RECOVERING",
      reason:
        "SERVER_DELTA_CHANGES_REMAIN",
    };
  }

  const summary =
    await getOutboxSummary(
      organizationId,
    );

  if (
    summary.conflict > 0
    || summary.failed > 0
  ) {
    return {
      ok: false,
      mode: "SYNC_REVIEW",
      reason:
        "OUTBOX_REVIEW_REQUIRED",
    };
  }

  if (
    summary.pending > 0
    || summary.syncing > 0
  ) {
    return {
      ok: false,
      mode: "RECOVERING",
      reason:
        "OUTBOX_NOT_DRAINED",
    };
  }

  // Store Hub acknowledgement is not required for cloud authority.
  // This best-effort publish only updates peers with later cloud ACK state.
  void synchronizeWithStoreHub(
    organizationId,
  );

  return {
    ok: true,
    mode: "CLOUD_ONLINE",
    outboxAcked:
      reconciliation.outboxAcked,
    pullPages:
      reconciliation.pullPages,
  };
}
