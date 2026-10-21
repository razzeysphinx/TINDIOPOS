import {
  POS_OPEN_TICKET_SPLIT_CONSTRAINT_DATABASE_CODE,
  POS_OPEN_TICKET_SPLIT_DATABASE_MESSAGE,
  POS_OPEN_TICKET_SPLIT_FEATURE,
  POS_OPEN_TICKET_SPLIT_INPUT_MESSAGE,
  POS_OPEN_TICKET_SPLIT_PATH,
  POS_OPEN_TICKET_SPLIT_PERMISSION_DATABASE_CODE,
  POS_OPEN_TICKET_SPLIT_PERMISSION_MESSAGE,
  POS_OPEN_TICKET_SPLIT_PERMISSIONS,
  POS_OPEN_TICKET_SPLIT_REQUEST_INVALID_MESSAGE,
  POS_OPEN_TICKET_SPLIT_RPC,
  POS_OPEN_TICKET_SPLIT_SUCCESS_MESSAGE,
  splitOpenTicketSchema,
  type OpenTicketSplitResult,
  type SplitOpenTicketValues,
} from "@tindio/contracts/open-ticket-split";

export const OPEN_TICKET_SPLIT_COMPATIBILITY_CONTRACT = {
  method: "POST",
  path: POS_OPEN_TICKET_SPLIT_PATH,
  permissions: POS_OPEN_TICKET_SPLIT_PERMISSIONS,
  feature: POS_OPEN_TICKET_SPLIT_FEATURE,
  rpc: POS_OPEN_TICKET_SPLIT_RPC,
  rpcArguments: [
    "target_organization_id",
    "target_source_ticket_id",
    "target_label",
    "target_lines",
  ],
  ticketScope: "organization-open-source-ticket",
  destinationInheritance: [
    "store",
    "register",
    "assigned-employee",
    "customer",
    "dining-option",
    "note",
  ],
  requiresOwnedOpenShift: true,
  labelBounds: { minimumLength: 1, maximumLength: 100, trimmed: true },
  lineBounds: {
    minimumLines: 1,
    maximumLines: 100,
    minimumQuantity: 0.001,
    maximumQuantity: 10_000,
    quantityScale: 3,
  },
  databaseOnlyValidation: [
    "unique-line-identifiers",
    "line-still-present",
    "quantity-not-above-saved",
    "destination-maximum-100-lines",
  ],
  partialLineBehavior: "clone-with-new-ticket-line-id",
  allSelectedSourceBehavior: "source-cart-remains-unchanged",
  audit: { event: "OPEN_TICKET_SPLIT", action: "ticket.split" },
  actionResponse: {
    status: 200,
    headers: { "cache-control": "private, no-store" },
  },
  malformedJsonResponse: {
    status: 400,
    headers: { "cache-control": "private, no-store" },
    body: { ok: false, message: POS_OPEN_TICKET_SPLIT_REQUEST_INVALID_MESSAGE },
  },
} as const;

export type OpenTicketSplitContext = {
  permissions: readonly string[];
  openTicketsEnabled: boolean;
};

export type OpenTicketSplitValidation =
  | { ok: true; input: SplitOpenTicketValues }
  | { ok: false; result: OpenTicketSplitResult };

export function validateOpenTicketSplit(
  value: unknown,
  context: OpenTicketSplitContext,
): OpenTicketSplitValidation {
  const parsed = splitOpenTicketSchema.safeParse(value);
  const hasContext = POS_OPEN_TICKET_SPLIT_PERMISSIONS.every((permission) =>
    context.permissions.includes(permission)
  ) && context.openTicketsEnabled;

  return parsed.success && hasContext
    ? { ok: true, input: parsed.data }
    : { ok: false, result: { ok: false, message: POS_OPEN_TICKET_SPLIT_INPUT_MESSAGE } };
}

export function toOpenTicketSplitRpcArguments(
  organizationId: string,
  input: SplitOpenTicketValues,
) {
  return {
    target_organization_id: organizationId,
    target_source_ticket_id: input.sourceTicketId,
    target_label: input.label,
    target_lines: input.lines.map((line) => ({
      ticket_line_id: line.ticketLineId,
      quantity: line.quantity,
    })),
  };
}

export function mapOpenTicketSplitRpcResult(
  ticketId: string | null,
  error: { code?: string | null; message?: string | null } | null,
): OpenTicketSplitResult {
  if (error || !ticketId) {
    const message = error?.message ?? undefined;
    return {
      ok: false,
      message:
        error?.code === POS_OPEN_TICKET_SPLIT_PERMISSION_DATABASE_CODE
          ? message?.toLowerCase().includes("device")
            ? message
            : POS_OPEN_TICKET_SPLIT_PERMISSION_MESSAGE
          : error?.code === POS_OPEN_TICKET_SPLIT_CONSTRAINT_DATABASE_CODE && message
            ? message
            : POS_OPEN_TICKET_SPLIT_DATABASE_MESSAGE,
    };
  }

  return { ok: true, ticketId, message: POS_OPEN_TICKET_SPLIT_SUCCESS_MESSAGE };
}
