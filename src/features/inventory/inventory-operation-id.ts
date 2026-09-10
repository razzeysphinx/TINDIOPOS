const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function storageKey(scope: string) {
  return `tindio:inventory-operation:${scope}`;
}

/**
 * Retains one operation ID for an unchanged browser-session request. The ID is
 * sent to the database so a retried stock-changing request returns its original
 * document instead of posting duplicate ledger movements.
 */
export function getInventoryOperationId(scope: string, payload?: unknown) {
  const key = storageKey(scope);
  const existing = globalThis.sessionStorage.getItem(key);

  if (payload === undefined) {
    if (existing && UUID_PATTERN.test(existing)) return existing;

    const operationId = globalThis.crypto.randomUUID();
    globalThis.sessionStorage.setItem(key, operationId);
    return operationId;
  }

  const fingerprint = JSON.stringify(payload);
  if (existing) {
    try {
      const stored = JSON.parse(existing) as { fingerprint?: unknown; id?: unknown };
      if (stored.fingerprint === fingerprint && typeof stored.id === "string" && UUID_PATTERN.test(stored.id)) return stored.id;
    } catch {
      // A malformed session-only value is safe to replace for this new request.
    }
  }

  const operationId = globalThis.crypto.randomUUID();
  globalThis.sessionStorage.setItem(key, JSON.stringify({ fingerprint, id: operationId }));
  return operationId;
}

export function clearInventoryOperationId(scope: string) {
  globalThis.sessionStorage.removeItem(storageKey(scope));
}
