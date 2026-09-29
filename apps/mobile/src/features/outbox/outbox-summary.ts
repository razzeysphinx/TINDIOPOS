import { getOldestUnresolvedOutboxEvent, getOutboxSummary } from "../../db/outbox";

export async function getSafeOutboxDiagnostics(organizationId: string) {
  const [summary, oldestUnresolved] = await Promise.all([
    getOutboxSummary(organizationId),
    getOldestUnresolvedOutboxEvent(organizationId),
  ]);
  return { summary, oldestUnresolved };
}
