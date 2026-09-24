import "server-only";

import {
  z,
} from "zod";

import type {
  PosReferenceV2Response,
} from "@/contracts/pos-v1";

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

type PosV2ReferenceBundle =
  PosReferenceV2Response["reference"];

export type PosV2ReferenceResult =
  | {
      ok: true;
      organizationId: string;
      referenceVersion: string;
      reference: PosV2ReferenceBundle;
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

function isNumber(
  value: unknown,
): value is number {
  return typeof value === "number"
    && Number.isFinite(value);
}

function isBoolean(
  value: unknown,
): value is boolean {
  return typeof value === "boolean";
}

function isNullableString(
  value: unknown,
): value is string | null {
  return value === null || isString(value);
}

function isCategory(
  value: unknown,
) {
  return isRecord(value)
    && isString(value.id)
    && isString(value.name)
    && isNullableString(value.color);
}

function isPaymentMethod(
  value: unknown,
) {
  return isRecord(value)
    && isString(value.id)
    && isString(value.storeId)
    && isString(value.name)
    && isString(value.code)
    && isString(value.type)
    && [
      "CASH",
      "CARD",
      "E_WALLET",
      "BANK_TRANSFER",
      "VOUCHER",
      "OTHER",
    ].includes(value.type)
    && isString(value.offlinePolicy)
    && [
      "disabled",
      "cash",
      "manual_external",
    ].includes(value.offlinePolicy)
    && isBoolean(value.requiresReference)
    && isNumber(value.sortOrder);
}

function isLoyaltyProgram(
  value: unknown,
) {
  return isRecord(value)
    && isBoolean(value.isEnabled)
    && isNumber(value.earnSpendMinor)
    && isNumber(value.earnPoints)
    && isNumber(value.redemptionValueMinor)
    && isNumber(
      value.minimumRedemptionPoints,
    );
}

function isDiscount(
  value: unknown,
) {
  return isRecord(value)
    && isString(value.id)
    && isString(value.name)
    && isString(value.discountType)
    && [
      "percentage",
      "fixed_amount",
    ].includes(value.discountType)
    && (value.percentageBps === null || isNumber(value.percentageBps))
    && (value.amountMinor === null || isNumber(value.amountMinor));
}

function isTaxRate(
  value: unknown,
) {
  return isRecord(value)
    && isString(value.id)
    && isString(value.name)
    && isNumber(value.rateBps)
    && isBoolean(value.isInclusive)
    && isBoolean(value.isDefault);
}

function isDiningOption(
  value: unknown,
) {
  return isRecord(value)
    && isString(value.id)
    && isString(value.name)
    && isBoolean(value.isDefault);
}

function isTicketTemplate(
  value: unknown,
) {
  return isRecord(value)
    && isString(value.id)
    && isString(value.label)
    && isNullableString(value.note)
    && isNullableString(value.diningOptionId);
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

function isReferenceBundle(
  value: unknown,
): value is PosV2ReferenceBundle {
  return isRecord(value)
    && hasEveryValue(value.categories, isCategory)
    && hasEveryValue(
      value.paymentMethods,
      isPaymentMethod,
    )
    && (
      value.loyaltyProgram === null
      || isLoyaltyProgram(value.loyaltyProgram)
    )
    && hasEveryValue(value.discounts, isDiscount)
    && hasEveryValue(value.taxRates, isTaxRate)
    && hasEveryValue(
      value.diningOptions,
      isDiningOption,
    )
    && hasEveryValue(
      value.ticketTemplates,
      isTicketTemplate,
    );
}

export async function getPosV2Reference(
  request: Request,
): Promise<PosV2ReferenceResult> {
  const token =
    bearerFromRequest(request);

  if (!token) {
    return {
      ok: false,
      status: 401,
      reason: "AUTH_REQUIRED",
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

  const requestedHeader =
    request.headers.get(
      POS_V2_ORGANIZATION_HEADER,
    );

  const parsedOrganization =
    requestedHeader
      ? uuidSchema.safeParse(
          requestedHeader,
        )
      : null;

  if (
    parsedOrganization
    && !parsedOrganization.success
  ) {
    return {
      ok: false,
      status: 403,
      reason:
        "ORGANIZATION_FORBIDDEN",
    };
  }

  const database =
    createPosV2DatabaseClient(token);

  let rpcResult;

  try {
    rpcResult =
      await retryPosV2IdentityUnmapped(
        () => database.rpc(
          "get_pos_reference_bundle_v2",
          parsedOrganization?.success
            ? {
                target_organization_id:
                  parsedOrganization.data,
              }
            : {},
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
        "INVALID_REFERENCE_RESPONSE",
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
    || !isString(payload.referenceVersion)
    || !isReferenceBundle(payload.reference)
  ) {
    return {
      ok: false,
      status: 503,
      reason:
        "INVALID_REFERENCE_RESPONSE",
    };
  }

  return {
    ok: true,
    organizationId:
      payload.organizationId,
    referenceVersion:
      payload.referenceVersion,
    reference:
      payload.reference,
  };
}
