import "server-only";

import {
  z,
} from "zod";

import type {
  PosLiveV2Response,
} from "@/contracts/pos-v1";
import type {
  PosCustomerDisplaySession,
} from "@/features/customer-display/customer-display-types";
import {
  mapPosV2IncomingTransfers,
  mapPosV2OpenTickets,
  mapPosV2TicketAssignees,
} from "@/features/pos/pos-v2-live-mappers";
import type {
  TimeClockEntry,
} from "@/features/time-clock/time-clock-types";
import {
  POS_V2_ORGANIZATION_HEADER,
} from "@/lib/auth/pos-v2-context";
import {
  createPosV2DatabaseClient,
  retryPosV2IdentityUnmapped,
} from "@/lib/supabase/pos-v2-database-client";
import {
  createClient,
} from "@/lib/supabase/server";

const uuidSchema =
  z.uuid();

const MAX_TOKEN_LENGTH =
  16_384;

const POS_V2_STORE_HEADER =
  "x-tindio-store-id";

const POS_V2_REGISTER_HEADER =
  "x-tindio-register-id";

type PosV2LivePayload =
  PosLiveV2Response["live"];

type PosV2LiveRpcPayload = {
  timeClockEntry:
    TimeClockEntry | null;
  customerDisplaySessions:
    PosCustomerDisplaySession[];
  canReceiveIncomingTransfers:
    boolean;
  incomingTransfersRaw: unknown[];
  openTicketsRaw: unknown[];
  ticketAssignees: unknown[];
};

export type PosV2LiveResult =
  | {
      ok: true;
      organizationId: string;
      storeId: string | null;
      registerId: string | null;
      live: PosV2LivePayload;
    }
  | {
      ok: false;
      status: 401 | 403 | 503;
      reason: string;
    };

function bearerFromRequest(
  request: Request,
) {
  const authorization =
    request.headers.get("authorization");

  if (!authorization) {
    return null;
  }

  const match =
    /^Bearer ([^\s]+)$/i.exec(
      authorization.trim(),
    );

  const token =
    match?.[1];

  if (
    !token
    || token.length > MAX_TOKEN_LENGTH
    || token.split(".").length !== 3
  ) {
    return null;
  }

  return token;
}

function authErrorStatus(
  error: unknown,
) {
  if (error instanceof SyntaxError) {
    return 401 as const;
  }

  const status =
    error
    && typeof error === "object"
    && "status" in error
    && typeof error.status === "number"
      ? error.status
      : null;

  if (
    status !== null
    && status >= 400
    && status < 500
    && status !== 429
  ) {
    return 401 as const;
  }

  return 503 as const;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
  );
}

function isString(
  value: unknown,
): value is string {
  return typeof value === "string";
}

function isNullableString(
  value: unknown,
): value is string | null {
  return value === null || isString(value);
}

function isTimeClockEntry(
  value: unknown,
): value is TimeClockEntry {
  return isRecord(value)
    && isString(value.id)
    && isString(value.employeeId)
    && isString(value.employeeName)
    && isString(value.storeId)
    && isString(value.storeName)
    && isString(value.clockedInAt)
    && (
      !("clockedOutAt" in value)
      || isNullableString(value.clockedOutAt)
    );
}

function isCustomerDisplaySession(
  value: unknown,
): value is PosCustomerDisplaySession {
  return isRecord(value)
    && isString(value.sessionId)
    && isString(value.registerId)
    && isString(value.realtimeTopic);
}

function hasEveryValue(
  value: unknown,
  predicate: (
    entry: unknown,
  ) => boolean,
) {
  return Array.isArray(value)
    && value.every(predicate);
}

function isLiveRpcPayload(
  value: unknown,
): value is PosV2LiveRpcPayload {
  return isRecord(value)
    && (
      value.timeClockEntry === null
      || isTimeClockEntry(value.timeClockEntry)
    )
    && hasEveryValue(
      value.customerDisplaySessions,
      isCustomerDisplaySession,
    )
    && typeof value.canReceiveIncomingTransfers === "boolean"
    && Array.isArray(value.incomingTransfersRaw)
    && Array.isArray(value.openTicketsRaw)
    && Array.isArray(value.ticketAssignees);
}

function parseOptionalUuidHeader(
  header: string | null,
) {
  if (!header) {
    return null;
  }

  return uuidSchema.safeParse(header);
}

export async function getPosV2Live(
  request: Request,
): Promise<PosV2LiveResult> {
  const token =
    bearerFromRequest(request);

  if (!token) {
    return {
      ok: false,
      status: 401,
      reason: "AUTH_REQUIRED",
    };
  }

  const requestedOrganization =
    request.headers.get(
      POS_V2_ORGANIZATION_HEADER,
    );
  const parsedOrganization =
    requestedOrganization
      ? uuidSchema.safeParse(
          requestedOrganization,
        )
      : null;

  if (
    !parsedOrganization
    || !parsedOrganization.success
  ) {
    return {
      ok: false,
      status: 403,
      reason: "ORGANIZATION_FORBIDDEN",
    };
  }

  const parsedStore =
    parseOptionalUuidHeader(
      request.headers.get(
        POS_V2_STORE_HEADER,
      ),
    );

  if (
    parsedStore
    && !parsedStore.success
  ) {
    return {
      ok: false,
      status: 403,
      reason: "STORE_FORBIDDEN",
    };
  }

  const parsedRegister =
    parseOptionalUuidHeader(
      request.headers.get(
        POS_V2_REGISTER_HEADER,
      ),
    );

  if (
    parsedRegister
    && !parsedRegister.success
  ) {
    return {
      ok: false,
      status: 403,
      reason: "REGISTER_FORBIDDEN",
    };
  }

  if (
    parsedRegister?.success
    && !parsedStore?.success
  ) {
    return {
      ok: false,
      status: 403,
      reason:
        "STORE_REQUIRED_FOR_REGISTER",
    };
  }

  const authClient =
    await createClient();

  let claimsResult;

  try {
    claimsResult =
      await authClient.auth.getClaims(
        token,
      );
  } catch (error) {
    const status =
      authErrorStatus(error);

    return {
      ok: false,
      status,
      reason:
        status === 401
          ? "AUTH_INVALID"
          : "AUTH_PROVIDER_UNAVAILABLE",
    };
  }

  if (
    claimsResult.error
    || !claimsResult.data?.claims
  ) {
    return {
      ok: false,
      status:
        authErrorStatus(
          claimsResult.error,
        ),
      reason:
        claimsResult.error
          ? "AUTH_INVALID_OR_UNAVAILABLE"
          : "AUTH_INVALID",
    };
  }

  const database =
    createPosV2DatabaseClient(token);

  let rpcResult;

  try {
    rpcResult =
      await retryPosV2IdentityUnmapped(
        () => database.rpc(
          "get_pos_live_state_v2",
          {
            target_organization_id:
              parsedOrganization.data,
            target_store_id:
              parsedStore?.success
                ? parsedStore.data
                : undefined,
            target_register_id:
              parsedRegister?.success
                ? parsedRegister.data
                : undefined,
          },
        ),
      );
  } catch {
    return {
      ok: false,
      status: 503,
      reason:
        "DATABASE_UNAVAILABLE",
    };
  }

  if (rpcResult.error) {
    return {
      ok: false,
      status: 503,
      reason:
        "DATABASE_UNAVAILABLE",
    };
  }

  const payload =
    rpcResult.data;

  if (!isRecord(payload)) {
    return {
      ok: false,
      status: 503,
      reason:
        "INVALID_LIVE_RESPONSE",
    };
  }

  if (payload.ok !== true) {
    const reason =
      isString(payload.reason)
        ? payload.reason
        : "POS_CONTEXT_UNAVAILABLE";

    return {
      ok: false,
      status:
        reason === "IDENTITY_UNMAPPED"
          ? 401
          : 403,
      reason,
    };
  }

  if (
    !isString(payload.organizationId)
    || !isNullableString(payload.storeId)
    || !isNullableString(payload.registerId)
    || !isLiveRpcPayload(payload.live)
  ) {
    return {
      ok: false,
      status: 503,
      reason:
        "INVALID_LIVE_RESPONSE",
    };
  }

  return {
    ok: true,
    organizationId:
      payload.organizationId,
    storeId: payload.storeId,
    registerId:
      payload.registerId,
    live: {
      timeClockEntry:
        payload.live.timeClockEntry,
      customerDisplaySessions:
        payload.live.customerDisplaySessions,
      canReceiveIncomingTransfers:
        payload.live.canReceiveIncomingTransfers,
      incomingTransfers:
        mapPosV2IncomingTransfers(
          payload.live.incomingTransfersRaw,
        ),
      openTickets:
        mapPosV2OpenTickets(
          payload.live.openTicketsRaw,
        ),
      ticketAssignees:
        mapPosV2TicketAssignees(
          payload.live.ticketAssignees,
        ),
    },
  };
}
