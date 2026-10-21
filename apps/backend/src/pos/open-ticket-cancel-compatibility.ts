import {
  POS_OPEN_TICKET_CANCEL_CONSTRAINT_DATABASE_CODE,
  POS_OPEN_TICKET_CANCEL_DATABASE_MESSAGE,
  POS_OPEN_TICKET_CANCEL_FEATURE,
  POS_OPEN_TICKET_CANCEL_INPUT_MESSAGE,
  POS_OPEN_TICKET_CANCEL_PATH,
  POS_OPEN_TICKET_CANCEL_PERMISSION_DATABASE_CODE,
  POS_OPEN_TICKET_CANCEL_PERMISSION_MESSAGE,
  POS_OPEN_TICKET_CANCEL_PERMISSIONS,
  POS_OPEN_TICKET_CANCEL_REQUEST_INVALID_MESSAGE,
  POS_OPEN_TICKET_CANCEL_RPC,
  POS_OPEN_TICKET_CANCEL_SUCCESS_MESSAGE,
  cancelOpenTicketSchema,
  type CancelOpenTicketValues,
  type OpenTicketCancelResult,
} from "@tindio/contracts/open-ticket-cancel";

export const OPEN_TICKET_CANCEL_COMPATIBILITY_CONTRACT = {
  method: "POST",
  path: POS_OPEN_TICKET_CANCEL_PATH,
  permissions: POS_OPEN_TICKET_CANCEL_PERMISSIONS,
  feature: POS_OPEN_TICKET_CANCEL_FEATURE,
  rpc: POS_OPEN_TICKET_CANCEL_RPC,
  rpcArguments: ["target_organization_id", "target_ticket_id"],
  ticketScope: "organization-open-ticket",
  storeScope: "derived-from-ticket",
  requiresOwnedOpenShift: true,
  repeatedCancel: "fails-closed-as-unavailable",
  actionResponse: {
    status: 200,
    headers: { "cache-control": "private, no-store" },
  },
  malformedJsonResponse: {
    status: 400,
    headers: { "cache-control": "private, no-store" },
    body: { ok: false, message: POS_OPEN_TICKET_CANCEL_REQUEST_INVALID_MESSAGE },
  },
} as const;

export type OpenTicketCancelContext = {
  permissions: readonly string[];
  openTicketsEnabled: boolean;
};

export type OpenTicketCancelValidation =
  | { ok: true; input: CancelOpenTicketValues }
  | { ok: false; result: OpenTicketCancelResult };

export function validateOpenTicketCancel(
  value: unknown,
  context: OpenTicketCancelContext,
): OpenTicketCancelValidation {
  const parsed = cancelOpenTicketSchema.safeParse(value);
  const hasContext = POS_OPEN_TICKET_CANCEL_PERMISSIONS.every((permission) =>
    context.permissions.includes(permission)
  ) && context.openTicketsEnabled;

  return parsed.success && hasContext
    ? { ok: true, input: parsed.data }
    : { ok: false, result: { ok: false, message: POS_OPEN_TICKET_CANCEL_INPUT_MESSAGE } };
}

export function toOpenTicketCancelRpcArguments(
  organizationId: string,
  input: CancelOpenTicketValues,
) {
  return {
    target_organization_id: organizationId,
    target_ticket_id: input.ticketId,
  };
}

export function mapOpenTicketCancelRpcResult(
  error: { code?: string | null; message?: string | null } | null,
): OpenTicketCancelResult {
  if (error) {
    const message = error.message ?? undefined;
    return {
      ok: false,
      message:
        error.code === POS_OPEN_TICKET_CANCEL_PERMISSION_DATABASE_CODE
          ? message?.toLowerCase().includes("device")
            ? message
            : POS_OPEN_TICKET_CANCEL_PERMISSION_MESSAGE
          : error.code === POS_OPEN_TICKET_CANCEL_CONSTRAINT_DATABASE_CODE && message
            ? message
            : POS_OPEN_TICKET_CANCEL_DATABASE_MESSAGE,
    };
  }

  return { ok: true, message: POS_OPEN_TICKET_CANCEL_SUCCESS_MESSAGE };
}
