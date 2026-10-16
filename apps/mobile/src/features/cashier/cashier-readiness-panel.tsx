import type { CashierReadinessState } from "../offline/cashier-readiness-policy";
import { TindioFeedback, type TindioFeedbackKind } from "../../ui/tindio-feedback";

type CashierReadinessPanelProps = { expiresAt: string | null; state: CashierReadinessState };

const presentation: Record<CashierReadinessState, { description: (expiresAt: string | null) => string; kind: TindioFeedbackKind; title: string }> = {
  READY_OFFLINE: { title: "This register is ready", description: () => "You can keep selling with saved store data if the connection drops.", kind: "empty" },
  EXPIRING_SOON: { title: "Reconnect soon", description: (expiresAt) => `Offline access expires ${expiresAt ? `at ${expiresAt}` : "soon"}. Reconnect before then to keep accepting supported cash sales.`, kind: "restriction" },
  EXPIRED_RECONNECT_REQUIRED: { title: "Reconnect before starting another offline sale", description: () => "Offline sales are paused. Accepted receipts and saved transactions remain available for recovery.", kind: "error" },
  PREPARATION_REQUIRED: { title: "Finish preparing this register", description: () => "Connect to TINDIO and complete the terminal assignment before beginning cashier work.", kind: "restriction" },
  RECOVERING: { title: "Reconnecting saved work", description: () => "TINDIO is checking saved transactions and store updates. Completion will be shown only after reconciliation finishes.", kind: "recovery" },
  SYNC_REVIEW: { title: "A transaction needs review", description: () => "Open Sync and recovery to review the saved entry. Nothing is deleted or hidden.", kind: "review" },
};

export function CashierReadinessPanel({ expiresAt, state }: CashierReadinessPanelProps) {
  const current = presentation[state];
  return <TindioFeedback description={current.description(expiresAt)} kind={current.kind} title={current.title} />;
}
