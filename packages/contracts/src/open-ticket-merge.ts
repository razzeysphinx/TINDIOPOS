import { z } from "zod";

export const POS_OPEN_TICKET_MERGE_PATH = "/api/pos/v2/tickets/merge" as const;
export const POS_OPEN_TICKET_MERGE_RPC = "merge_open_tickets" as const;
export const POS_OPEN_TICKET_MERGE_PERMISSIONS = [
  "pos.access",
  "sales.create",
  "tickets.manage",
] as const;
export const POS_OPEN_TICKET_MERGE_FEATURE = "open_tickets" as const;
export const POS_OPEN_TICKET_MERGE_PERMISSION_DATABASE_CODE = "42501" as const;
export const POS_OPEN_TICKET_MERGE_CONSTRAINT_DATABASE_CODE = "23514" as const;
export const POS_OPEN_TICKET_MERGE_NOT_FOUND_DATABASE_CODE = "P0002" as const;

export const POS_OPEN_TICKET_MERGE_REQUEST_INVALID_MESSAGE =
  "The request data is invalid." as const;
export const POS_OPEN_TICKET_MERGE_INPUT_MESSAGE =
  "Choose two different open tickets." as const;
export const POS_OPEN_TICKET_MERGE_PERMISSION_MESSAGE =
  "You do not have permission to change these tickets." as const;
export const POS_OPEN_TICKET_MERGE_DATABASE_MESSAGE =
  "TINDIO could not save the ticket change. Nothing was moved." as const;
export const POS_OPEN_TICKET_MERGE_SUCCESS_MESSAGE =
  "Tickets merged. The original source ticket remains in the audit history." as const;

const openTicketMergeDeviceCredentialSchema = z.object({
  deviceId: z.uuid(),
  secret: z.string().regex(/^[0-9a-fA-F]{64}$/),
  appVersion: z.string().trim().min(1).max(80),
});

export const mergeOpenTicketsSchema = z.object({
  sourceTicketId: z.uuid(),
  destinationTicketId: z.uuid(),
  device: openTicketMergeDeviceCredentialSchema.nullable().optional(),
});

export type MergeOpenTicketsValues = z.infer<typeof mergeOpenTicketsSchema>;

export type OpenTicketMergeResult =
  | { ok: true; message: string }
  | { ok: false; message: string };
