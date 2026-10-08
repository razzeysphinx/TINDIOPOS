export const OUTBOX_MAX_EXPONENTIAL_DELAY_MS = 60_000;
export const OUTBOX_MAX_SERVER_RETRY_DELAY_MS = 300_000;

export function outboxRetryDelayMs(attempts: number, jitter = Math.random()) {
  const exponent = Math.min(Math.max(attempts - 1, 0), 6);
  const base = Math.min(OUTBOX_MAX_EXPONENTIAL_DELAY_MS, 1_000 * 2 ** exponent);
  const normalizedJitter = Math.min(1, Math.max(0, jitter));
  return Math.min(
    OUTBOX_MAX_EXPONENTIAL_DELAY_MS,
    Math.round(base * (0.8 + normalizedJitter * 0.4)),
  );
}

export function nextOutboxRetryAt(
  attempts: number,
  now = Date.now(),
  serverRetryAfterMs = 0,
  jitter = Math.random(),
) {
  const boundedServerDelay = Math.min(
    OUTBOX_MAX_SERVER_RETRY_DELAY_MS,
    Math.max(0, serverRetryAfterMs),
  );
  const delay = Math.max(
    outboxRetryDelayMs(attempts, jitter),
    boundedServerDelay,
  );
  return new Date(now + delay).toISOString();
}
