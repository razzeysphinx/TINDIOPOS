import {
  readStoreHubConfig,
  type StoreHubConfig,
} from "./store-hub-config";

export type StoreHubActivityEvent = {
  eventId: string;
  organizationId: string;
  storeId: string;
  deviceId: string;
  deviceSequence: number;
  type: "SALE_COMPLETED";
  createdAt: string;
  localReference: string;
  items: Array<{
    productId: string;
    variantId: string | null;
    quantity: number;
  }>;
  cloudSyncedAt: string | null;
};

export type StoreHubChange = {
  hubRevision: number;
  acceptedAt: string;
  event: StoreHubActivityEvent;
};

async function request(
  config: StoreHubConfig,
  pathname: string,
  init: RequestInit = {},
) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    3_000,
  );

  try {
    return await fetch(
      new URL(pathname, `${config.endpoint}/`).toString(),
      {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${config.token}`,
          ...Object.fromEntries(
            new Headers(init.headers).entries(),
          ),
        },
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function probeStoreHub(input: {
  organizationId: string;
  storeId: string;
}) {
  const config = await readStoreHubConfig(
    input.organizationId,
  );

  if (
    !config
    || config.storeId !== input.storeId
  ) {
    return {
      ok: false as const,
      reason: "STORE_HUB_NOT_CONFIGURED",
    };
  }

  try {
    const response = await request(
      config,
      "/health",
    );

    if (!response.ok) {
      return {
        ok: false as const,
        reason: `STORE_HUB_HTTP_${response.status}`,
      };
    }

    const body = await response.json() as {
      ok?: boolean;
      organizationId?: string;
      storeId?: string;
      currentRevision?: number;
    };

    if (
      !body.ok
      || body.organizationId !== input.organizationId
      || body.storeId !== input.storeId
    ) {
      return {
        ok: false as const,
        reason: "STORE_HUB_SCOPE_MISMATCH",
      };
    }

    return {
      ok: true as const,
      config,
      currentRevision:
        Number.isSafeInteger(body.currentRevision)
          ? body.currentRevision!
          : 0,
    };
  } catch {
    return {
      ok: false as const,
      reason: "STORE_HUB_UNREACHABLE",
    };
  }
}

export async function publishStoreHubEvent(
  config: StoreHubConfig,
  event: StoreHubActivityEvent,
) {
  const response = await request(
    config,
    "/v1/events",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    },
  );

  const body = await response.json().catch(
    () => null,
  ) as {
    ok?: boolean;
    reason?: string;
    hubRevision?: number;
    replayed?: boolean;
  } | null;

  if (!response.ok || !body?.ok) {
    throw new Error(
      body?.reason
      ?? `STORE_HUB_HTTP_${response.status}`,
    );
  }

  return {
    hubRevision: body.hubRevision ?? 0,
    replayed: Boolean(body.replayed),
  };
}

export async function pullStoreHubChanges(
  config: StoreHubConfig,
  cursor: number,
  limit = 100,
) {
  const response = await request(
    config,
    `/v1/events?after=${cursor}&limit=${Math.min(limit, 200)}`,
  );

  const body = await response.json().catch(
    () => null,
  ) as {
    ok?: boolean;
    organizationId?: string;
    storeId?: string;
    changes?: StoreHubChange[];
    nextCursor?: number;
    hasMore?: boolean;
    currentRevision?: number;
  } | null;

  if (
    !response.ok
    || !body?.ok
    || body.organizationId !== config.organizationId
    || body.storeId !== config.storeId
    || !Array.isArray(body.changes)
  ) {
    throw new Error(
      `STORE_HUB_PULL_INVALID_${response.status}`,
    );
  }

  return {
    changes: body.changes,
    nextCursor:
      Number.isSafeInteger(body.nextCursor)
        ? body.nextCursor!
        : cursor,
    hasMore: Boolean(body.hasMore),
    currentRevision:
      Number.isSafeInteger(body.currentRevision)
        ? body.currentRevision!
        : cursor,
  };
}
