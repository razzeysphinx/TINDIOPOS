import {
  POS_OPEN_TICKET_MERGE_CONSTRAINT_DATABASE_CODE,
  POS_OPEN_TICKET_MERGE_DATABASE_MESSAGE,
  POS_OPEN_TICKET_MERGE_FEATURE,
  POS_OPEN_TICKET_MERGE_INPUT_MESSAGE,
  POS_OPEN_TICKET_MERGE_PATH,
  POS_OPEN_TICKET_MERGE_PERMISSION_DATABASE_CODE,
  POS_OPEN_TICKET_MERGE_PERMISSION_MESSAGE,
  POS_OPEN_TICKET_MERGE_PERMISSIONS,
  POS_OPEN_TICKET_MERGE_REQUEST_INVALID_MESSAGE,
  POS_OPEN_TICKET_MERGE_RPC,
  POS_OPEN_TICKET_MERGE_SUCCESS_MESSAGE,
  mergeOpenTicketsSchema,
  type MergeOpenTicketsValues,
  type OpenTicketMergeResult,
} from "@tindio/contracts/open-ticket-merge";

export const OPEN_TICKET_MERGE_COMPATIBILITY_CONTRACT = {
  method: "POST",
  path: POS_OPEN_TICKET_MERGE_PATH,
  permissions: POS_OPEN_TICKET_MERGE_PERMISSIONS,
  feature: POS_OPEN_TICKET_MERGE_FEATURE,
  rpc: POS_OPEN_TICKET_MERGE_RPC,
  rpcArguments: [
    "target_organization_id",
    "target_source_ticket_id",
    "target_destination_ticket_id",
  ],
  ticketScope: "organization-open-source-and-destination",
  registerScope: "same-store-and-register",
  requiresOwnedOpenShift: true,
  databaseOnlyValidation: [
    "distinct-source-and-destination",
    "source-still-open",
    "destination-still-open",
    "destination-maximum-100-lines",
  ],
  sourceLineBehavior: "move-all-lines-and-preserve-audit-cart",
  destinationLineBehavior: "append-source-lines-preserving-line-identifiers",
  sourceStatusAfterMerge: "merged-with-destination-reference",
  audit: { event: "OPEN_TICKETS_MERGED", action: "ticket.merge" },
  actionResponse: {
    status: 200,
    headers: { "cache-control": "private, no-store" },
  },
  malformedJsonResponse: {
    status: 400,
    headers: { "cache-control": "private, no-store" },
    body: { ok: false, message: POS_OPEN_TICKET_MERGE_REQUEST_INVALID_MESSAGE },
  },
} as const;

export type OpenTicketMergeContext = {
  permissions: readonly string[];
  openTicketsEnabled: boolean;
};

export type OpenTicketMergeValidation =
  | { ok: true; input: MergeOpenTicketsValues }
  | { ok: false; result: OpenTicketMergeResult };

export function validateOpenTicketMerge(
  value: unknown,
  context: OpenTicketMergeContext,
): OpenTicketMergeValidation {
  const parsed = mergeOpenTicketsSchema.safeParse(value);
  const hasContext = POS_OPEN_TICKET_MERGE_PERMISSIONS.every((permission) =>
    context.permissions.includes(permission)
  ) && context.openTicketsEnabled;

  return parsed.success && hasContext
    ? { ok: true, input: parsed.data }
    : { ok: false, result: { ok: false, message: POS_OPEN_TICKET_MERGE_INPUT_MESSAGE } };
}

export function toOpenTicketMergeRpcArguments(
  organizationId: string,
  input: MergeOpenTicketsValues,
) {
  return {
    target_organization_id: organizationId,
    target_source_ticket_id: input.sourceTicketId,
    target_destination_ticket_id: input.destinationTicketId,
  };
}

export function mapOpenTicketMergeRpcResult(
  error: { code?: string | null; message?: string | null } | null,
): OpenTicketMergeResult {
  if (error) {
    const message = error.message ?? undefined;
    return {
      ok: false,
      message:
        error.code === POS_OPEN_TICKET_MERGE_PERMISSION_DATABASE_CODE
          ? message?.toLowerCase().includes("device")
            ? message
            : POS_OPEN_TICKET_MERGE_PERMISSION_MESSAGE
          : error.code === POS_OPEN_TICKET_MERGE_CONSTRAINT_DATABASE_CODE && message
            ? message
            : POS_OPEN_TICKET_MERGE_DATABASE_MESSAGE,
    };
  }

  return { ok: true, message: POS_OPEN_TICKET_MERGE_SUCCESS_MESSAGE };
}
