import "server-only";

import type {
  NextRequest,
} from "next/server";
import {
  z,
} from "zod";

import {
  posCatalogV2QuerySchema,
  posModifierQuerySchema,
} from "@/contracts/pos-v1";
import type {
  PosCatalogV2Response,
  PosModifierGroup,
  PosModifierOption,
  PosModifiersV2Response,
} from "@/contracts/pos-v1";
import type {
  PosCatalogItem,
} from "@/features/pos/pos-types";
import {
  POS_V2_ORGANIZATION_HEADER,
} from "@/lib/auth/pos-v2-context";
import {
  createPosV2DatabaseClient,
} from "@/lib/supabase/pos-v2-database-client";
import {
  createClient,
} from "@/lib/supabase/server";

const uuidSchema =
  z.uuid();

const MAX_TOKEN_LENGTH =
  16_384;

type PosCatalogV2Payload =
  Omit<
    PosCatalogV2Response,
    "version" | "requestId"
  >;

type PosModifiersV2Payload =
  Omit<
    PosModifiersV2Response,
    "version" | "requestId"
  >;

type PosV2CatalogContext =
  | {
      ok: true;
      organizationId: string;
      token: string;
    }
  | {
      ok: false;
      status: 401 | 403 | 503;
      reason: string;
    };

export type PosV2CatalogResult =
  | {
      ok: true;
      catalog: PosCatalogV2Payload;
    }
  | {
      ok: false;
      status: 400 | 401 | 403 | 503;
      reason: string;
    };

export type PosV2ModifiersResult =
  | {
      ok: true;
      modifiers: PosModifiersV2Payload;
    }
  | {
      ok: false;
      status: 400 | 401 | 403 | 503;
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
  if (
    error
    && typeof error === "object"
    && "status" in error
    && (
      error.status === 401
      || error.status === 403
    )
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

function isBoolean(
  value: unknown,
): value is boolean {
  return typeof value === "boolean";
}

function isNumber(
  value: unknown,
): value is number {
  return typeof value === "number"
    && Number.isFinite(value);
}

function isNullableString(
  value: unknown,
): value is string | null {
  return value === null || isString(value);
}

function hasEveryValue<T>(
  value: unknown,
  predicate: (
    entry: unknown,
  ) => entry is T,
): value is T[] {
  return Array.isArray(value)
    && value.every(predicate);
}

function isCatalogItem(
  value: unknown,
): value is PosCatalogItem {
  return isRecord(value)
    && isString(value.productId)
    && isNullableString(value.variantId)
    && isNullableString(value.categoryId)
    && isString(value.productName)
    && isNullableString(value.variantName)
    && isNullableString(value.sku)
    && isNullableString(value.barcode)
    && isNumber(value.priceMinor)
    && isString(value.unit)
    && isNullableString(value.imageUrl)
    && isBoolean(value.isVariablePrice)
    && isBoolean(value.allowFractionalQuantity)
    && (
      !("hasModifiers" in value)
      || isBoolean(value.hasModifiers)
    );
}

function isModifierOption(
  value: unknown,
): value is PosModifierOption {
  return isRecord(value)
    && isString(value.id)
    && isString(value.name)
    && isNumber(value.priceMinor);
}

function isModifierGroup(
  value: unknown,
): value is PosModifierGroup {
  return isRecord(value)
    && isString(value.id)
    && isString(value.name)
    && isNumber(value.minSelections)
    && isNumber(value.maxSelections)
    && hasEveryValue(
      value.options,
      isModifierOption,
    );
}

async function getPosV2CatalogContext(
  request: Request,
): Promise<PosV2CatalogContext> {
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
      await authClient.auth.getClaims(token);
  } catch (error) {
    return {
      ok: false,
      status: authErrorStatus(error),
      reason: "AUTH_PROVIDER_UNAVAILABLE",
    };
  }

  if (
    claimsResult.error
    || !claimsResult.data?.claims
  ) {
    return {
      ok: false,
      status: authErrorStatus(
        claimsResult.error,
      ),
      reason: claimsResult.error
        ? "AUTH_INVALID_OR_UNAVAILABLE"
        : "AUTH_INVALID",
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

  return {
    ok: true,
    organizationId: parsedOrganization.data,
    token,
  };
}

function queryValue(
  request: NextRequest,
  name: string,
) {
  return request.nextUrl.searchParams.get(name)
    ?? undefined;
}

function rpcFailure(
  payload: Record<string, unknown>,
) {
  const reason =
    isString(payload.reason)
      ? payload.reason
      : "POS_CONTEXT_UNAVAILABLE";

  if (reason === "IDENTITY_UNMAPPED") {
    return {
      ok: false as const,
      status: 401 as const,
      reason,
    };
  }

  if (
    reason === "CATALOG_MODE_INVALID"
    || reason === "CATALOG_PAGE_INVALID"
  ) {
    return {
      ok: false as const,
      status: 400 as const,
      reason,
    };
  }

  return {
    ok: false as const,
    status: 403 as const,
    reason,
  };
}

export async function getPosV2Catalog(
  request: NextRequest,
): Promise<PosV2CatalogResult> {
  const parsedQuery =
    posCatalogV2QuerySchema.safeParse({
      store: queryValue(request, "store"),
      mode: queryValue(request, "mode"),
      query: queryValue(request, "query"),
      category: queryValue(request, "category"),
      offset: queryValue(request, "offset"),
      limit: queryValue(request, "limit"),
    });

  if (!parsedQuery.success) {
    return {
      ok: false,
      status: 400,
      reason: "CATALOG_QUERY_INVALID",
    };
  }

  const context =
    await getPosV2CatalogContext(request);

  if (!context.ok) {
    return context;
  }

  const database =
    createPosV2DatabaseClient(context.token);

  let rpcResult;

  try {
    rpcResult =
      await database.rpc(
        "get_pos_catalog_v2",
        {
          target_organization_id:
            context.organizationId,
          target_store_id:
            parsedQuery.data.store,
          target_mode:
            parsedQuery.data.mode,
          target_query:
            parsedQuery.data.query || undefined,
          target_category_id:
            parsedQuery.data.category,
          target_offset:
            parsedQuery.data.offset,
          target_limit:
            parsedQuery.data.limit,
        },
      );
  } catch {
    return {
      ok: false,
      status: 503,
      reason: "DATABASE_UNAVAILABLE",
    };
  }

  if (rpcResult.error) {
    return {
      ok: false,
      status: 503,
      reason: "DATABASE_UNAVAILABLE",
    };
  }

  if (!isRecord(rpcResult.data)) {
    return {
      ok: false,
      status: 503,
      reason: "INVALID_CATALOG_RESPONSE",
    };
  }

  if (rpcResult.data.ok !== true) {
    return rpcFailure(rpcResult.data);
  }

  const payload =
    rpcResult.data;

  if (
    !isString(payload.organizationId)
    || !isString(payload.storeId)
    || !(
      payload.mode === "search"
      || payload.mode === "favorites"
      || payload.mode === "recent"
    )
    || !isNumber(payload.offset)
    || !isNumber(payload.limit)
    || !hasEveryValue(payload.items, isCatalogItem)
    || !isBoolean(payload.hasMore)
  ) {
    return {
      ok: false,
      status: 503,
      reason: "INVALID_CATALOG_RESPONSE",
    };
  }

  return {
    ok: true,
    catalog: {
      ok: true,
      organizationId: payload.organizationId,
      storeId: payload.storeId,
      mode: payload.mode,
      offset: payload.offset,
      limit: payload.limit,
      items: payload.items,
      hasMore: payload.hasMore,
    },
  };
}

export async function getPosV2Modifiers(
  request: NextRequest,
): Promise<PosV2ModifiersResult> {
  const parsedQuery =
    posModifierQuerySchema.safeParse({
      product: queryValue(request, "product"),
      store: queryValue(request, "store"),
    });

  if (!parsedQuery.success) {
    return {
      ok: false,
      status: 400,
      reason: "MODIFIER_QUERY_INVALID",
    };
  }

  const context =
    await getPosV2CatalogContext(request);

  if (!context.ok) {
    return context;
  }

  const database =
    createPosV2DatabaseClient(context.token);

  let rpcResult;

  try {
    rpcResult =
      await database.rpc(
        "get_pos_modifiers_v2",
        {
          target_organization_id:
            context.organizationId,
          target_store_id:
            parsedQuery.data.store,
          target_product_id:
            parsedQuery.data.product,
        },
      );
  } catch {
    return {
      ok: false,
      status: 503,
      reason: "DATABASE_UNAVAILABLE",
    };
  }

  if (rpcResult.error) {
    return {
      ok: false,
      status: 503,
      reason: "DATABASE_UNAVAILABLE",
    };
  }

  if (!isRecord(rpcResult.data)) {
    return {
      ok: false,
      status: 503,
      reason: "INVALID_MODIFIERS_RESPONSE",
    };
  }

  if (rpcResult.data.ok !== true) {
    return rpcFailure(rpcResult.data);
  }

  const payload =
    rpcResult.data;

  if (
    !isString(payload.organizationId)
    || !isString(payload.storeId)
    || !isString(payload.productId)
    || !hasEveryValue(payload.groups, isModifierGroup)
  ) {
    return {
      ok: false,
      status: 503,
      reason: "INVALID_MODIFIERS_RESPONSE",
    };
  }

  return {
    ok: true,
    modifiers: {
      ok: true,
      organizationId: payload.organizationId,
      storeId: payload.storeId,
      productId: payload.productId,
      groups: payload.groups,
    },
  };
}
