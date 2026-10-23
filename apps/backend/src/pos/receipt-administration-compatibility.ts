import {
  POS_RECEIPT_DELIVERY_CHANNEL,
  POS_RECEIPT_DELIVERY_CONSTRAINT_DATABASE_CODE,
  POS_RECEIPT_DELIVERY_DATABASE_MESSAGE,
  POS_RECEIPT_DELIVERY_DATABASE_PERMISSION_MESSAGE,
  POS_RECEIPT_DELIVERY_IDEMPOTENCY_DATABASE_CODE,
  POS_RECEIPT_DELIVERY_IDEMPOTENCY_MESSAGE,
  POS_RECEIPT_DELIVERY_INPUT_MESSAGE,
  POS_RECEIPT_DELIVERY_PERMISSION,
  POS_RECEIPT_DELIVERY_PERMISSION_DATABASE_CODE,
  POS_RECEIPT_DELIVERY_PERMISSION_MESSAGE,
  POS_RECEIPT_DELIVERY_RPC,
  receiptDeliverySchema,
  receiptDeliverySuccessMessage,
  type ReceiptDeliveryDatabaseRow,
  type ReceiptDeliveryResult,
  type ReceiptDeliveryValues,
} from "@tindio/contracts/receipt-delivery";
import {
  POS_RECEIPT_SETTINGS_CONSTRAINT_DATABASE_CODE,
  POS_RECEIPT_SETTINGS_DATABASE_MESSAGE,
  POS_RECEIPT_SETTINGS_DATABASE_PERMISSION_MESSAGE,
  POS_RECEIPT_SETTINGS_INPUT_MESSAGE,
  POS_RECEIPT_SETTINGS_PERMISSION,
  POS_RECEIPT_SETTINGS_PERMISSION_DATABASE_CODE,
  POS_RECEIPT_SETTINGS_PERMISSION_MESSAGE,
  POS_RECEIPT_SETTINGS_RPC,
  POS_RECEIPT_SETTINGS_SUCCESS_MESSAGE,
  receiptSettingsSchema,
  type ReceiptSettingsResult,
  type ReceiptSettingsValues,
} from "@tindio/contracts/receipt-settings";

export const RECEIPT_ADMINISTRATION_COMPATIBILITY_CONTRACT = {
  authority: "next-server-actions",
  settingsEntryPoint: "updateReceiptSettingsAction",
  deliveryEntryPoint: "queueReceiptDeliveryAction",
  authentication: "required-business-context-before-permissions-and-input",
  organizationScope: "required-business-context-organization",
  settingsPermission: POS_RECEIPT_SETTINGS_PERMISSION,
  deliveryPermission: POS_RECEIPT_DELIVERY_PERMISSION,
  settingsRpc: POS_RECEIPT_SETTINGS_RPC,
  deliveryRpc: POS_RECEIPT_DELIVERY_RPC,
  deliveryChannel: POS_RECEIPT_DELIVERY_CHANNEL,
  deliveryIdentity: "receipt-id-in-organization-and-sale-read-scope",
  deliveryIdempotency: "organization-key-plus-actor-and-canonical-receipt-channel-recipient-payload",
  databaseEffects: [
    "upsert-one-organization-receipt-settings-row",
    "capture-settings-snapshot-only-on-future-receipts",
    "insert-immutable-digital-receipt-outbox-row",
  ],
  revalidation: [
    "/back-office/receipt-settings",
    "/back-office/receipts",
    "/back-office/receipts/{receiptId}",
  ],
} as const;

export type ReceiptAdministrationContext = { permissions: readonly string[] };
type DatabaseError = { code?: string; message?: string } | null;

export type ReceiptSettingsValidation =
  | { ok: true; input: ReceiptSettingsValues }
  | { ok: false; result: ReceiptSettingsResult };

export function validateReceiptSettings(
  value: unknown,
  context: ReceiptAdministrationContext,
): ReceiptSettingsValidation {
  if (!context.permissions.includes(POS_RECEIPT_SETTINGS_PERMISSION)) {
    return { ok: false, result: { ok: false, message: POS_RECEIPT_SETTINGS_PERMISSION_MESSAGE } };
  }
  const parsed = receiptSettingsSchema.safeParse(value);
  return parsed.success
    ? { ok: true, input: parsed.data }
    : { ok: false, result: { ok: false, message: POS_RECEIPT_SETTINGS_INPUT_MESSAGE } };
}

export function toReceiptSettingsRpcArguments(
  organizationId: string,
  input: ReceiptSettingsValues,
) {
  return {
    target_organization_id: organizationId,
    target_business_name: input.businessName,
    target_business_address: input.businessAddress,
    target_business_phone: input.businessPhone,
    target_business_email: input.businessEmail,
    target_business_tax_id: input.businessTaxId,
    target_business_website: input.businessWebsite,
    target_header_message: input.headerMessage,
    target_footer_message: input.footerMessage,
    target_paper_width_mm: input.paperWidthMm,
    target_show_store_address: input.showStoreAddress,
    target_show_store_phone: input.showStorePhone,
    target_show_cashier: input.showCashier,
    target_show_register: input.showRegister,
    target_show_payment_details: input.showPaymentDetails,
  };
}

export function mapReceiptSettingsRpcResult(
  data: boolean | null,
  error: DatabaseError,
): ReceiptSettingsResult {
  if (error || !data) {
    return {
      ok: false,
      message:
        error?.code === POS_RECEIPT_SETTINGS_PERMISSION_DATABASE_CODE
          ? POS_RECEIPT_SETTINGS_DATABASE_PERMISSION_MESSAGE
          : error?.code === POS_RECEIPT_SETTINGS_CONSTRAINT_DATABASE_CODE && error.message
            ? error.message
            : POS_RECEIPT_SETTINGS_DATABASE_MESSAGE,
    };
  }
  return { ok: true, message: POS_RECEIPT_SETTINGS_SUCCESS_MESSAGE };
}

export type ReceiptDeliveryValidation =
  | { ok: true; input: ReceiptDeliveryValues }
  | { ok: false; result: ReceiptDeliveryResult };

export function validateReceiptDelivery(
  value: unknown,
  context: ReceiptAdministrationContext,
): ReceiptDeliveryValidation {
  if (!context.permissions.includes(POS_RECEIPT_DELIVERY_PERMISSION)) {
    return { ok: false, result: { ok: false, message: POS_RECEIPT_DELIVERY_PERMISSION_MESSAGE } };
  }
  const parsed = receiptDeliverySchema.safeParse(value);
  return parsed.success
    ? { ok: true, input: parsed.data }
    : { ok: false, result: { ok: false, message: POS_RECEIPT_DELIVERY_INPUT_MESSAGE } };
}

export function toReceiptDeliveryRpcArguments(
  organizationId: string,
  input: ReceiptDeliveryValues,
) {
  return {
    target_organization_id: organizationId,
    target_receipt_id: input.receiptId,
    target_delivery_channel: POS_RECEIPT_DELIVERY_CHANNEL,
    target_recipient: input.recipient,
    target_idempotency_key: input.idempotencyKey,
  };
}

export function mapReceiptDeliveryRpcResult(
  data: ReceiptDeliveryDatabaseRow[] | null,
  error: DatabaseError,
): ReceiptDeliveryResult {
  const row = data?.[0];
  if (error || !row) {
    return {
      ok: false,
      message:
        error?.code === POS_RECEIPT_DELIVERY_PERMISSION_DATABASE_CODE
          ? POS_RECEIPT_DELIVERY_DATABASE_PERMISSION_MESSAGE
          : error?.code === POS_RECEIPT_DELIVERY_IDEMPOTENCY_DATABASE_CODE
            ? error.message ?? POS_RECEIPT_DELIVERY_IDEMPOTENCY_MESSAGE
            : error?.code === POS_RECEIPT_DELIVERY_CONSTRAINT_DATABASE_CODE && error.message
              ? error.message
              : POS_RECEIPT_DELIVERY_DATABASE_MESSAGE,
    };
  }
  return { ok: true, message: receiptDeliverySuccessMessage(row) };
}
