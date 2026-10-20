import type { PosLiveV2Response } from "@tindio/contracts/pos-runtime";

import {
  mapPosV2IncomingTransfers,
  mapPosV2OpenTickets,
  mapPosV2TicketAssignees,
} from "./live-mappers.js";
import { POS_V2_ORGANIZATION_HEADER } from "./bootstrap-owned.js";

const MAX_TOKEN_LENGTH = 16_384;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POS_V2_STORE_HEADER = "x-tindio-store-id";
const POS_V2_REGISTER_HEADER = "x-tindio-register-id";

type ClaimsResult = {
  data?: { claims?: Record<string, unknown> } | null;
  error?: unknown;
};

type DatabaseResult = { data: unknown; error: unknown };

export type OwnedLiveDependencies = {
  createRequestId: () => string;
  verifyClaims: (token: string) => Promise<ClaimsResult>;
  loadLive: (
    token: string,
    organizationId: string,
    storeId: string | undefined,
    registerId: string | undefined,
  ) => Promise<DatabaseResult>;
};

type LiveRpcPayload = {
  timeClockEntry: PosLiveV2Response["live"]["timeClockEntry"];
  customerDisplaySessions: PosLiveV2Response["live"]["customerDisplaySessions"];
  canReceiveIncomingTransfers: boolean;
  incomingTransfersRaw: unknown[];
  openTicketsRaw: unknown[];
  ticketAssignees: unknown[];
};

function jsonResponse(body: Record<string, unknown>, status: number, requestId: string): Response {
  const response = Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
  response.headers.set("x-tindio-request-id", requestId);
  return response;
}

function failure(
  status: 401 | 403 | 503,
  reason: string,
  requestId: string,
): Response {
  return jsonResponse({ ok: false, reason, requestId }, status, requestId);
}

function bearerFromRequest(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;

  const token = /^Bearer ([^\s]+)$/i.exec(authorization.trim())?.[1];
  return token
    && token.length <= MAX_TOKEN_LENGTH
    && token.split(".").length === 3
      ? token
      : null;
}

function authErrorStatus(error: unknown): 401 | 503 {
  if (error instanceof SyntaxError) return 401;

  const status = error
    && typeof error === "object"
    && "status" in error
    && typeof error.status === "number"
      ? error.status
      : null;

  return status !== null && status >= 400 && status < 500 && status !== 429
    ? 401
    : 503;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const isString = (value: unknown): value is string => typeof value === "string";
const isNullableString = (value: unknown): value is string | null =>
  value === null || isString(value);

function isTimeClockEntry(value: unknown): value is NonNullable<LiveRpcPayload["timeClockEntry"]> {
  return isRecord(value)
    && isString(value.id)
    && isString(value.employeeId)
    && isString(value.employeeName)
    && isString(value.storeId)
    && isString(value.storeName)
    && isString(value.clockedInAt)
    && (!("clockedOutAt" in value) || isNullableString(value.clockedOutAt));
}

function isCustomerDisplaySession(
  value: unknown,
): value is LiveRpcPayload["customerDisplaySessions"][number] {
  return isRecord(value)
    && isString(value.sessionId)
    && isString(value.registerId)
    && isString(value.realtimeTopic);
}

function isLiveRpcPayload(value: unknown): value is LiveRpcPayload {
  return isRecord(value)
    && (value.timeClockEntry === null || isTimeClockEntry(value.timeClockEntry))
    && Array.isArray(value.customerDisplaySessions)
    && value.customerDisplaySessions.every(isCustomerDisplaySession)
    && typeof value.canReceiveIncomingTransfers === "boolean"
    && Array.isArray(value.incomingTransfersRaw)
    && Array.isArray(value.openTicketsRaw)
    && Array.isArray(value.ticketAssignees);
}

function optionalUuid(value: string | null): string | null | false {
  if (!value) return null;
  return UUID_PATTERN.test(value) ? value : false;
}

function isIdentityUnmapped(value: unknown): boolean {
  return isRecord(value) && value.reason === "IDENTITY_UNMAPPED";
}

export async function handleOwnedPosLive(
  request: Request,
  dependencies: OwnedLiveDependencies,
): Promise<Response> {
  const requestId = dependencies.createRequestId();
  const token = bearerFromRequest(request);
  if (!token) return failure(401, "AUTH_REQUIRED", requestId);

  const requestedOrganization = request.headers.get(POS_V2_ORGANIZATION_HEADER);
  if (!requestedOrganization || !UUID_PATTERN.test(requestedOrganization)) {
    return failure(403, "ORGANIZATION_FORBIDDEN", requestId);
  }

  const storeId = optionalUuid(request.headers.get(POS_V2_STORE_HEADER));
  if (storeId === false) return failure(403, "STORE_FORBIDDEN", requestId);

  const registerId = optionalUuid(request.headers.get(POS_V2_REGISTER_HEADER));
  if (registerId === false) return failure(403, "REGISTER_FORBIDDEN", requestId);
  if (registerId && !storeId) {
    return failure(403, "STORE_REQUIRED_FOR_REGISTER", requestId);
  }

  let claimsResult: ClaimsResult;
  try {
    claimsResult = await dependencies.verifyClaims(token);
  } catch (error) {
    const status = authErrorStatus(error);
    return failure(
      status,
      status === 401 ? "AUTH_INVALID" : "AUTH_PROVIDER_UNAVAILABLE",
      requestId,
    );
  }

  if (claimsResult.error || !claimsResult.data?.claims) {
    return failure(
      authErrorStatus(claimsResult.error),
      claimsResult.error ? "AUTH_INVALID_OR_UNAVAILABLE" : "AUTH_INVALID",
      requestId,
    );
  }

  let liveResult: DatabaseResult;
  try {
    liveResult = await dependencies.loadLive(
      token,
      requestedOrganization,
      storeId ?? undefined,
      registerId ?? undefined,
    );
    if (!liveResult.error && isIdentityUnmapped(liveResult.data)) {
      liveResult = await dependencies.loadLive(
        token,
        requestedOrganization,
        storeId ?? undefined,
        registerId ?? undefined,
      );
    }
  } catch {
    return failure(503, "DATABASE_UNAVAILABLE", requestId);
  }

  if (liveResult.error) return failure(503, "DATABASE_UNAVAILABLE", requestId);
  if (!isRecord(liveResult.data)) {
    return failure(503, "INVALID_LIVE_RESPONSE", requestId);
  }

  const payload = liveResult.data;
  if (payload.ok !== true) {
    const reason = isString(payload.reason) ? payload.reason : "POS_CONTEXT_UNAVAILABLE";
    return failure(reason === "IDENTITY_UNMAPPED" ? 401 : 403, reason, requestId);
  }

  if (
    !isString(payload.organizationId)
    || !isNullableString(payload.storeId)
    || !isNullableString(payload.registerId)
    || !isLiveRpcPayload(payload.live)
  ) return failure(503, "INVALID_LIVE_RESPONSE", requestId);

  const body: PosLiveV2Response = {
    ok: true,
    version: 2,
    requestId,
    organizationId: payload.organizationId,
    storeId: payload.storeId,
    registerId: payload.registerId,
    live: {
      timeClockEntry: payload.live.timeClockEntry,
      customerDisplaySessions: payload.live.customerDisplaySessions,
      canReceiveIncomingTransfers: payload.live.canReceiveIncomingTransfers,
      incomingTransfers: mapPosV2IncomingTransfers(payload.live.incomingTransfersRaw),
      openTickets: mapPosV2OpenTickets(payload.live.openTicketsRaw),
      ticketAssignees: mapPosV2TicketAssignees(payload.live.ticketAssignees),
    },
  };

  return jsonResponse(body, 200, requestId);
}
