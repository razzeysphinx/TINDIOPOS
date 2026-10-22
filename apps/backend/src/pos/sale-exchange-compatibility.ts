import {
  POS_SALE_EXCHANGE_CONSTRAINT_DATABASE_CODE,
  POS_SALE_EXCHANGE_DATABASE_MESSAGE,
  POS_SALE_EXCHANGE_DATABASE_PERMISSION_MESSAGE,
  POS_SALE_EXCHANGE_IDEMPOTENCY_DATABASE_CODE,
  POS_SALE_EXCHANGE_IDEMPOTENCY_MESSAGE,
  POS_SALE_EXCHANGE_INPUT_MESSAGE,
  POS_SALE_EXCHANGE_NOT_FOUND_DATABASE_CODE,
  POS_SALE_EXCHANGE_PERMISSION_DATABASE_CODE,
  POS_SALE_EXCHANGE_PERMISSION_MESSAGE,
  POS_SALE_EXCHANGE_PERMISSIONS,
  POS_SALE_EXCHANGE_RPC,
  saleExchangeSchema,
  saleExchangeSuccessMessage,
  type SaleExchangeDatabaseRow,
  type SaleExchangeResult,
  type SaleExchangeValues,
} from "@tindio/contracts/sale-exchange";

export const SALE_EXCHANGE_COMPATIBILITY_CONTRACT = {
  authority: "next-server-action",
  entryPoint: "linkSaleExchangeAction",
  authentication: "required-business-context-before-permissions-and-input",
  organizationScope: "required-business-context-organization",
  permissions: POS_SALE_EXCHANGE_PERMISSIONS,
  rpc: POS_SALE_EXCHANGE_RPC,
  refundIdentity: "completed-refund-in-context-organization",
  replacementIdentity: "completed-sale-derived-from-organization-receipt-number",
  idempotency: "organization-key-plus-actor-and-canonical-refund-replacement-payload",
  immutableCustody: "insert-link-only-source-sale-refund-and-replacement-sale-unchanged",
  revalidation: ["/back-office/receipts", "/back-office/receipts/[receiptId]:page"],
} as const;

export type SaleExchangeContext = { permissions: readonly string[] };

export type SaleExchangeValidation =
  | { ok: true; input: SaleExchangeValues }
  | { ok: false; result: SaleExchangeResult };

export function validateSaleExchange(
  value: unknown,
  context: SaleExchangeContext,
): SaleExchangeValidation {
  if (!POS_SALE_EXCHANGE_PERMISSIONS.every((permission) => context.permissions.includes(permission))) {
    return { ok: false, result: { ok: false, message: POS_SALE_EXCHANGE_PERMISSION_MESSAGE } };
  }
  const parsed = saleExchangeSchema.safeParse(value);
  return parsed.success
    ? { ok: true, input: parsed.data }
    : { ok: false, result: { ok: false, message: POS_SALE_EXCHANGE_INPUT_MESSAGE } };
}

export function toSaleExchangeRpcArguments(
  organizationId: string,
  input: SaleExchangeValues,
) {
  return {
    target_organization_id: organizationId,
    target_refund_id: input.refundId,
    target_replacement_receipt_number: input.replacementReceiptNumber,
    target_idempotency_key: input.idempotencyKey,
  };
}

type SaleExchangeDatabaseError = { code?: string; message?: string } | null;

export function mapSaleExchangeRpcResult(
  data: SaleExchangeDatabaseRow[] | null,
  error: SaleExchangeDatabaseError,
): SaleExchangeResult {
  const row = data?.[0];
  if (error || !row) {
    const message = error?.message;
    return {
      ok: false,
      message:
        error?.code === POS_SALE_EXCHANGE_PERMISSION_DATABASE_CODE
          ? POS_SALE_EXCHANGE_DATABASE_PERMISSION_MESSAGE
          : error?.code === POS_SALE_EXCHANGE_IDEMPOTENCY_DATABASE_CODE
            ? message ?? POS_SALE_EXCHANGE_IDEMPOTENCY_MESSAGE
            : (error?.code === POS_SALE_EXCHANGE_CONSTRAINT_DATABASE_CODE
                || error?.code === POS_SALE_EXCHANGE_NOT_FOUND_DATABASE_CODE) && message
              ? message
              : POS_SALE_EXCHANGE_DATABASE_MESSAGE,
    };
  }
  return { ok: true, message: saleExchangeSuccessMessage(row) };
}
