import {
  POS_CUSTOMER_CREATION_DATABASE_MESSAGE,
  POS_CUSTOMER_CREATION_INPUT_MESSAGE,
  POS_CUSTOMER_CREATION_PATH,
  POS_CUSTOMER_CREATION_PERMISSION,
  POS_CUSTOMER_CREATION_PERMISSION_MESSAGE,
  POS_CUSTOMER_CREATION_REQUEST_INVALID_MESSAGE,
  POS_CUSTOMER_CREATION_SELECT,
  POS_CUSTOMER_CREATION_SUCCESS_MESSAGE,
  POS_CUSTOMER_CREATION_TABLE,
  createCustomerSchema,
  type CreateCustomerValues,
  type CustomerCreationDatabaseRow,
  type PosCustomerCreationResult,
} from "@tindio/contracts/customer-creation";

export const CUSTOMER_CREATION_COMPATIBILITY_CONTRACT = {
  method: "POST",
  path: POS_CUSTOMER_CREATION_PATH,
  permission: POS_CUSTOMER_CREATION_PERMISSION,
  table: POS_CUSTOMER_CREATION_TABLE,
  select: POS_CUSTOMER_CREATION_SELECT,
  requiresAssignedStore: false,
  requiresOpenShift: false,
  actionResponse: {
    status: 200,
    headers: { "cache-control": "private, no-store" },
  },
  malformedJsonResponse: {
    status: 400,
    headers: { "cache-control": "private, no-store" },
    body: { ok: false, message: POS_CUSTOMER_CREATION_REQUEST_INVALID_MESSAGE },
  },
} as const;

export type CustomerCreationValidation =
  | { ok: true; input: CreateCustomerValues }
  | { ok: false; result: PosCustomerCreationResult };

export function validateCustomerCreation(value: unknown): CustomerCreationValidation {
  const parsed = createCustomerSchema.safeParse(value);
  return parsed.success
    ? { ok: true, input: parsed.data }
    : { ok: false, result: { ok: false, message: POS_CUSTOMER_CREATION_INPUT_MESSAGE } };
}

export function customerCreationPermissionFailure(): PosCustomerCreationResult {
  return { ok: false, message: POS_CUSTOMER_CREATION_PERMISSION_MESSAGE };
}

export function customerCreationDatabaseFailure(
  error: { message?: string | null } | null,
): PosCustomerCreationResult {
  return {
    ok: false,
    message: error?.message?.includes("customers_")
      ? POS_CUSTOMER_CREATION_INPUT_MESSAGE
      : POS_CUSTOMER_CREATION_DATABASE_MESSAGE,
  };
}

export function mapCreatedCustomer(
  row: CustomerCreationDatabaseRow,
): PosCustomerCreationResult {
  return {
    ok: true,
    message: POS_CUSTOMER_CREATION_SUCCESS_MESSAGE,
    data: {
      id: row.id,
      customerNumber: row.customer_number,
      loyaltyCardCode: row.loyalty_card_code,
      fullName: row.full_name,
      email: row.email,
      phone: row.phone,
      loyaltyPoints: 0,
    },
  };
}
