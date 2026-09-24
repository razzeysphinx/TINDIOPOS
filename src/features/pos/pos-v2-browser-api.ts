"use client";

import type {
  PosBootstrapV2CoreResponse,
  PosCatalogV2Query,
  PosCatalogV2Response,
  PosLiveV2Response,
  PosModifiersV2Response,
  PosReferenceV2Response,
} from "@/contracts/pos";
import {
  getRealtimeClient,
} from "@/lib/supabase/realtime-client";

const ORGANIZATION_HEADER =
  "x-tindio-organization-id";

const STORE_HEADER =
  "x-tindio-store-id";

const REGISTER_HEADER =
  "x-tindio-register-id";

let browserClient:
  ReturnType<typeof getRealtimeClient>
  | null = null;

function getBrowserClient() {
  browserClient ??= getRealtimeClient();

  return browserClient;
}

export class PosV2ApiError
  extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: string,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "PosV2ApiError";
  }
}

async function accessToken(
  refresh = false,
) {
  const client =
    getBrowserClient();
  const result =
    refresh
      ? await client.auth.refreshSession()
      : await client.auth.getSession();

  if (
    result.error
    || !result.data.session
  ) {
    throw new PosV2ApiError(
      "Sign in is required.",
      401,
      "AUTH_REQUIRED",
      null,
    );
  }

  return result.data.session.access_token;
}

async function parseFailure(
  response: Response,
) {
  let payload: Record<string, unknown> = {};

  try {
    const value =
      await response.json();

    if (
      value
      && typeof value === "object"
      && !Array.isArray(value)
    ) {
      payload = value as Record<string, unknown>;
    }
  } catch {
    // The status remains authoritative.
  }

  const reason =
    typeof payload.reason === "string"
      ? payload.reason
      : `HTTP_${response.status}`;
  const requestId =
    typeof payload.requestId === "string"
      ? payload.requestId
      : response.headers.get(
          "x-tindio-request-id",
        );

  return new PosV2ApiError(
    reason,
    response.status,
    reason,
    requestId,
  );
}

async function authorizedFetch(
  input: string,
  {
    organizationId,
    requestHeaders,
    requestInit = {},
    retryAuth = true,
  }: {
    organizationId?: string;
    requestHeaders?: Headers;
    requestInit?: RequestInit;
    retryAuth?: boolean;
  } = {},
) {
  const token =
    await accessToken();
  const headers =
    new Headers({
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    });

  requestHeaders?.forEach(
    (value, name) => headers.set(name, value),
  );

  if (organizationId) {
    headers.set(
      ORGANIZATION_HEADER,
      organizationId,
    );
  }

  const request =
    () => fetch(input, {
      ...requestInit,
      cache: "no-store",
      headers,
    });

  let response =
    await request();

  if (
    response.status === 401
    && retryAuth
  ) {
    const refreshedToken =
      await accessToken(true);

    headers.set(
      "Authorization",
      `Bearer ${refreshedToken}`,
    );

    response =
      await request();
  }

  if (!response.ok) {
    throw await parseFailure(response);
  }

  return response;
}

export async function fetchPosV2Command(
  input: string,
  {
    organizationId,
    headers,
    ...requestInit
  }: RequestInit & {
    organizationId: string;
  },
) {
  return authorizedFetch(
    input,
    {
      organizationId,
      requestHeaders:
        new Headers(headers),
      requestInit,
    },
  );
}

export async function fetchPosV2Core(
  organizationId?: string,
) {
  const response =
    await authorizedFetch(
      "/api/pos/v2/bootstrap",
      { organizationId },
    );

  return (
    await response.json()
  ) as PosBootstrapV2CoreResponse;
}

export async function fetchPosV2Reference(
  organizationId: string,
) {
  const response =
    await authorizedFetch(
      "/api/pos/v2/reference",
      { organizationId },
    );

  return (
    await response.json()
  ) as PosReferenceV2Response;
}

export async function fetchPosV2Live(
  organizationId: string,
  scope: {
    storeId?: string | null;
    registerId?: string | null;
  } = {},
) {
  const requestHeaders =
    new Headers();

  if (scope.storeId) {
    requestHeaders.set(
      STORE_HEADER,
      scope.storeId,
    );
  }

  if (scope.registerId) {
    requestHeaders.set(
      REGISTER_HEADER,
      scope.registerId,
    );
  }

  const response =
    await authorizedFetch(
      "/api/pos/v2/live",
      {
        organizationId,
        requestHeaders,
      },
    );

  return (
    await response.json()
  ) as PosLiveV2Response;
}

export async function fetchPosV2Catalog(
  organizationId: string,
  query: PosCatalogV2Query,
) {
  const params =
    new URLSearchParams({
      store: query.store,
      mode: query.mode,
      offset: String(query.offset),
      limit: String(query.limit),
    });

  if (query.query) {
    params.set("query", query.query);
  }

  if (query.category) {
    params.set("category", query.category);
  }

  const response =
    await authorizedFetch(
      `/api/pos/v2/catalog?${params.toString()}`,
      { organizationId },
    );

  return (
    await response.json()
  ) as PosCatalogV2Response;
}

export async function fetchPosV2Modifiers(
  organizationId: string,
  storeId: string,
  productId: string,
) {
  const params =
    new URLSearchParams({
      store: storeId,
      product: productId,
    });
  const response =
    await authorizedFetch(
      `/api/pos/v2/modifiers?${params.toString()}`,
      { organizationId },
    );

  return (
    await response.json()
  ) as PosModifiersV2Response;
}
