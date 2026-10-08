export const POS_API_REQUEST_TIMEOUT_MS = 15_000;

export class PosApiRequestTimeoutError extends Error {
  constructor() {
    super("The TINDIO API request timed out.");
    this.name = "PosApiRequestTimeoutError";
  }
}

export async function fetchWithTimeout(
  fetchImplementation: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = POS_API_REQUEST_TIMEOUT_MS,
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("A positive request timeout is required.");
  }

  const controller = new AbortController();
  const callerSignal = init.signal;
  let timedOut = false;

  const abortFromCaller = () => controller.abort();
  if (callerSignal?.aborted) {
    controller.abort();
  } else {
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetchImplementation(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) throw new PosApiRequestTimeoutError();
    throw error;
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}
