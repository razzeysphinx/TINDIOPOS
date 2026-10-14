export type StoreHubReplicaContinuity = {
  reset: boolean;
  reason: "ENDPOINT_CHANGED" | "CURSOR_AHEAD" | null;
};

export function evaluateStoreHubReplicaContinuity(input: {
  state: {
    hubUrl: string;
    pullCursor: number;
  } | null;
  endpoint: string;
  currentRevision: number;
}): StoreHubReplicaContinuity {
  if (!input.state) {
    return { reset: false, reason: null };
  }

  if (input.state.hubUrl !== input.endpoint) {
    return { reset: true, reason: "ENDPOINT_CHANGED" };
  }

  if (input.state.pullCursor > input.currentRevision) {
    return { reset: true, reason: "CURSOR_AHEAD" };
  }

  return { reset: false, reason: null };
}
