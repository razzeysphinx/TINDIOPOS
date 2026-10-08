export type CloudEntryPolicyInput = {
  previousMode: string | null;
  unresolvedTransactions: number;
  terminalEnrolled: boolean;
  syncCursorInitialized: boolean;
};

export function shouldRecoverCloudEntry(input: CloudEntryPolicyInput) {
  return input.unresolvedTransactions > 0
    || Boolean(input.previousMode && input.previousMode !== "CLOUD_ONLINE")
    || (input.terminalEnrolled && !input.syncCursorInitialized);
}

export function shouldReloadAfterAppStateChange(
  previousState: string,
  nextState: string,
) {
  return previousState !== "active" && nextState === "active";
}
