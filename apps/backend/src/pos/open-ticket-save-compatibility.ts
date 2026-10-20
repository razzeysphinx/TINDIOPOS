import {
  POS_OPEN_TICKET_SAVE_CONSTRAINT_DATABASE_CODE,
  POS_OPEN_TICKET_SAVE_DATABASE_MESSAGE,
  POS_OPEN_TICKET_SAVE_FEATURE,
  POS_OPEN_TICKET_SAVE_INPUT_MESSAGE,
  POS_OPEN_TICKET_SAVE_PATH,
  POS_OPEN_TICKET_SAVE_PERMISSION_DATABASE_CODE,
  POS_OPEN_TICKET_SAVE_PERMISSION_MESSAGE,
  POS_OPEN_TICKET_SAVE_PERMISSIONS,
  POS_OPEN_TICKET_SAVE_REQUEST_INVALID_MESSAGE,
  POS_OPEN_TICKET_SAVE_RPC,
  POS_OPEN_TICKET_SAVE_SUCCESS_MESSAGE,
  saveOpenTicketSchema,
  type OpenTicketSaveResult,
  type SaveOpenTicketValues,
} from "@tindio/contracts/open-ticket-save";

export const OPEN_TICKET_SAVE_COMPATIBILITY_CONTRACT = {
  method: "POST",
  path: POS_OPEN_TICKET_SAVE_PATH,
  permissions: POS_OPEN_TICKET_SAVE_PERMISSIONS,
  feature: POS_OPEN_TICKET_SAVE_FEATURE,
  rpc: POS_OPEN_TICKET_SAVE_RPC,
  rpcArguments: [
    "target_organization_id",
    "target_store_id",
    "target_register_id",
    "target_ticket_id",
    "target_customer_id",
    "target_dining_option_id",
    "target_assigned_employee_id",
    "target_label",
    "target_note",
    "target_cart",
  ],
  requiresAssignedStore: true,
  requiresOwnedOpenShift: true,
  idempotency: {
    createWithoutTicketId: "none",
    updateWithTicketId: "stable-target",
  },
  actionResponse: {
    status: 200,
    headers: { "cache-control": "private, no-store" },
  },
  malformedJsonResponse: {
    status: 400,
    headers: { "cache-control": "private, no-store" },
    body: { ok: false, message: POS_OPEN_TICKET_SAVE_REQUEST_INVALID_MESSAGE },
  },
} as const;

export type OpenTicketSaveContext = {
  permissions: readonly string[];
  openTicketsEnabled: boolean;
  assignedStoreIds: readonly string[];
};

export type OpenTicketSaveValidation =
  | { ok: true; input: SaveOpenTicketValues }
  | { ok: false; result: OpenTicketSaveResult };

export function validateOpenTicketSave(
  value: unknown,
  context: OpenTicketSaveContext,
): OpenTicketSaveValidation {
  const parsed = saveOpenTicketSchema.safeParse(value);
  const hasContext = POS_OPEN_TICKET_SAVE_PERMISSIONS.every((permission) =>
    context.permissions.includes(permission)
  ) && context.openTicketsEnabled;

  return parsed.success && hasContext && context.assignedStoreIds.includes(parsed.data.storeId)
    ? { ok: true, input: parsed.data }
    : { ok: false, result: { ok: false, message: POS_OPEN_TICKET_SAVE_INPUT_MESSAGE } };
}

export function toOpenTicketSaveRpcArguments(
  organizationId: string,
  input: SaveOpenTicketValues,
) {
  return {
    target_organization_id: organizationId,
    target_store_id: input.storeId,
    target_register_id: input.registerId,
    target_ticket_id: input.ticketId ?? null,
    target_customer_id: input.customerId ?? null,
    target_dining_option_id: input.diningOptionId ?? null,
    target_assigned_employee_id: input.assignedEmployeeId ?? null,
    target_label: input.label,
    target_note: input.note || null,
    target_cart: input.cart.map((line) => ({
      product_id: line.productId,
      variant_id: line.variantId,
      quantity: line.quantity,
      unit_price_minor: line.manualPriceMinor,
      modifier_option_ids: line.modifierOptionIds,
      ticket_line_id: line.ticketLineId,
      item_note: line.itemNote || null,
      productName: line.productName,
      variantName: line.variantName,
      sku: line.sku,
      barcode: line.barcode,
      categoryId: line.categoryId,
      priceMinor: line.priceMinor,
      unit: line.unit,
      imageUrl: line.imageUrl ?? null,
      isVariablePrice: line.isVariablePrice,
      allowFractionalQuantity: line.allowFractionalQuantity,
      manualPriceMinor: line.manualPriceMinor,
      modifiers: line.modifiers ?? [],
    })),
  };
}

export function mapOpenTicketSaveRpcResult(
  ticket: Array<{ ticket_id: string }> | null,
  error: { code?: string | null; message?: string | null } | null,
): OpenTicketSaveResult {
  if (error || !ticket?.[0]) {
    const message = error?.message ?? undefined;
    return {
      ok: false,
      message:
        error?.code === POS_OPEN_TICKET_SAVE_PERMISSION_DATABASE_CODE
          ? message?.toLowerCase().includes("device")
            ? message
            : POS_OPEN_TICKET_SAVE_PERMISSION_MESSAGE
          : error?.code === POS_OPEN_TICKET_SAVE_CONSTRAINT_DATABASE_CODE && message
            ? message
            : POS_OPEN_TICKET_SAVE_DATABASE_MESSAGE,
    };
  }

  return {
    ok: true,
    ticketId: ticket[0].ticket_id,
    message: POS_OPEN_TICKET_SAVE_SUCCESS_MESSAGE,
  };
}
