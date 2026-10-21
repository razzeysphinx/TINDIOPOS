import {
  POS_OPEN_TICKET_MOVE_LINES_CONSTRAINT_DATABASE_CODE,
  POS_OPEN_TICKET_MOVE_LINES_DATABASE_MESSAGE,
  POS_OPEN_TICKET_MOVE_LINES_FEATURE,
  POS_OPEN_TICKET_MOVE_LINES_INPUT_MESSAGE,
  POS_OPEN_TICKET_MOVE_LINES_PATH,
  POS_OPEN_TICKET_MOVE_LINES_PERMISSION_DATABASE_CODE,
  POS_OPEN_TICKET_MOVE_LINES_PERMISSION_MESSAGE,
  POS_OPEN_TICKET_MOVE_LINES_PERMISSIONS,
  POS_OPEN_TICKET_MOVE_LINES_REQUEST_INVALID_MESSAGE,
  POS_OPEN_TICKET_MOVE_LINES_RPC,
  POS_OPEN_TICKET_MOVE_LINES_SUCCESS_MESSAGE,
  moveOpenTicketLinesSchema,
  type MoveOpenTicketLinesValues,
  type OpenTicketMoveLinesResult,
} from "@tindio/contracts/open-ticket-move-lines";

export const OPEN_TICKET_MOVE_LINES_COMPATIBILITY_CONTRACT = {
  method: "POST",
  path: POS_OPEN_TICKET_MOVE_LINES_PATH,
  permissions: POS_OPEN_TICKET_MOVE_LINES_PERMISSIONS,
  feature: POS_OPEN_TICKET_MOVE_LINES_FEATURE,
  rpc: POS_OPEN_TICKET_MOVE_LINES_RPC,
  rpcArguments: [
    "target_organization_id",
    "target_source_ticket_id",
    "target_destination_ticket_id",
    "target_lines",
  ],
  ticketScope: "organization-open-tickets-on-same-store-and-register",
  requiresOwnedOpenShift: true,
  lineBounds: {
    minimumLines: 1,
    maximumLines: 100,
    minimumQuantity: 0.001,
    maximumQuantity: 10_000,
    quantityScale: 3,
  },
  databaseOnlyValidation: [
    "distinct-source-and-destination",
    "unique-line-identifiers",
    "line-still-present",
    "quantity-not-above-saved",
    "same-open-register",
    "destination-maximum-100-lines",
    "source-retains-at-least-one-line",
  ],
  partialLineBehavior: "clone-with-new-ticket-line-id",
  audit: { event: "OPEN_TICKET_LINES_MOVED", action: "ticket.move" },
  actionResponse: {
    status: 200,
    headers: { "cache-control": "private, no-store" },
  },
  malformedJsonResponse: {
    status: 400,
    headers: { "cache-control": "private, no-store" },
    body: { ok: false, message: POS_OPEN_TICKET_MOVE_LINES_REQUEST_INVALID_MESSAGE },
  },
} as const;

export type OpenTicketMoveLinesContext = {
  permissions: readonly string[];
  openTicketsEnabled: boolean;
};

export type OpenTicketMoveLinesValidation =
  | { ok: true; input: MoveOpenTicketLinesValues }
  | { ok: false; result: OpenTicketMoveLinesResult };

export function validateOpenTicketMoveLines(
  value: unknown,
  context: OpenTicketMoveLinesContext,
): OpenTicketMoveLinesValidation {
  const parsed = moveOpenTicketLinesSchema.safeParse(value);
  const hasContext = POS_OPEN_TICKET_MOVE_LINES_PERMISSIONS.every((permission) =>
    context.permissions.includes(permission)
  ) && context.openTicketsEnabled;

  return parsed.success && hasContext
    ? { ok: true, input: parsed.data }
    : { ok: false, result: { ok: false, message: POS_OPEN_TICKET_MOVE_LINES_INPUT_MESSAGE } };
}

export function toOpenTicketMoveLinesRpcArguments(
  organizationId: string,
  input: MoveOpenTicketLinesValues,
) {
  return {
    target_organization_id: organizationId,
    target_source_ticket_id: input.sourceTicketId,
    target_destination_ticket_id: input.destinationTicketId,
    target_lines: input.lines.map((line) => ({
      ticket_line_id: line.ticketLineId,
      quantity: line.quantity,
    })),
  };
}

export function mapOpenTicketMoveLinesRpcResult(
  error: { code?: string | null; message?: string | null } | null,
): OpenTicketMoveLinesResult {
  if (error) {
    const message = error.message ?? undefined;
    return {
      ok: false,
      message:
        error.code === POS_OPEN_TICKET_MOVE_LINES_PERMISSION_DATABASE_CODE
          ? message?.toLowerCase().includes("device")
            ? message
            : POS_OPEN_TICKET_MOVE_LINES_PERMISSION_MESSAGE
          : error.code === POS_OPEN_TICKET_MOVE_LINES_CONSTRAINT_DATABASE_CODE && message
            ? message
            : POS_OPEN_TICKET_MOVE_LINES_DATABASE_MESSAGE,
    };
  }

  return { ok: true, message: POS_OPEN_TICKET_MOVE_LINES_SUCCESS_MESSAGE };
}
