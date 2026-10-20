import {
  CUSTOMER_DISPLAY_INVALID_ERROR,
  CUSTOMER_DISPLAY_OPEN_SHIFT_DATABASE_CODE,
  CUSTOMER_DISPLAY_OPEN_SHIFT_ERROR,
  CUSTOMER_DISPLAY_PERMISSION_ERROR,
  CUSTOMER_DISPLAY_UPDATE_ERROR,
  CUSTOMER_DISPLAY_UPDATE_PATH,
  CUSTOMER_DISPLAY_UPDATE_PERMISSIONS,
  CUSTOMER_DISPLAY_UPDATE_RPC,
  customerDisplayUpdateSchema,
  type CustomerDisplayUpdate,
} from "@tindio/contracts/customer-display";

export const CUSTOMER_DISPLAY_COMPATIBILITY_CONTRACT = {
  method: "PUT",
  path: CUSTOMER_DISPLAY_UPDATE_PATH,
  permissions: CUSTOMER_DISPLAY_UPDATE_PERMISSIONS,
  rpc: CUSTOMER_DISPLAY_UPDATE_RPC,
  rpcArguments: [
    "target_organization_id",
    "target_session_id",
    "target_state",
  ],
  success: {
    status: 204,
    body: null,
    headers: { "cache-control": "no-store" },
  },
} as const;

export type CustomerDisplayCompatibilityFailure = {
  ok: false;
  status: 400 | 403 | 500;
  body: { error: string };
};

export type CustomerDisplayCompatibilityValidation =
  | { ok: true; update: CustomerDisplayUpdate }
  | CustomerDisplayCompatibilityFailure;

export function validateCustomerDisplayUpdate(
  value: unknown,
): CustomerDisplayCompatibilityValidation {
  const parsed = customerDisplayUpdateSchema.safeParse(value);
  return parsed.success
    ? { ok: true, update: parsed.data }
    : {
        ok: false,
        status: 400,
        body: { error: CUSTOMER_DISPLAY_INVALID_ERROR },
      };
}

export function customerDisplayPermissionFailure(): CustomerDisplayCompatibilityFailure {
  return {
    ok: false,
    status: 403,
    body: { error: CUSTOMER_DISPLAY_PERMISSION_ERROR },
  };
}

export function mapCustomerDisplayRpcError(
  error: { code?: string | null },
): CustomerDisplayCompatibilityFailure {
  const isOpenShiftDenial = error.code === CUSTOMER_DISPLAY_OPEN_SHIFT_DATABASE_CODE;
  return {
    ok: false,
    status: isOpenShiftDenial ? 403 : 500,
    body: {
      error: isOpenShiftDenial
        ? CUSTOMER_DISPLAY_OPEN_SHIFT_ERROR
        : CUSTOMER_DISPLAY_UPDATE_ERROR,
    },
  };
}
