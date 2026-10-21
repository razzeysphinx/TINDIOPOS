import { z } from "zod";

export const POS_OPEN_TICKET_CANCEL_PATH = "/api/pos/v2/tickets/cancel" as const;
export const POS_OPEN_TICKET_CANCEL_RPC = "cancel_open_ticket" as const;
export const POS_OPEN_TICKET_CANCEL_PERMISSIONS = [
  "pos.access",
  "sales.create",
  "tickets.manage",
] as const;
export const POS_OPEN_TICKET_CANCEL_FEATURE = "open_tickets" as const;
export const POS_OPEN_TICKET_CANCEL_PERMISSION_DATABASE_CODE = "42501" as const;
export const POS_OPEN_TICKET_CANCEL_CONSTRAINT_DATABASE_CODE = "23514" as const;
export const POS_OPEN_TICKET_CANCEL_NOT_FOUND_DATABASE_CODE = "P0002" as const;

export const POS_OPEN_TICKET_CANCEL_REQUEST_INVALID_MESSAGE =
  "The request data is invalid." as const;
export const POS_OPEN_TICKET_CANCEL_INPUT_MESSAGE =
  "This ticket is unavailable." as const;
export const POS_OPEN_TICKET_CANCEL_PERMISSION_MESSAGE =
  "You do not have permission to change these tickets." as const;
export const POS_OPEN_TICKET_CANCEL_DATABASE_MESSAGE =
  "TINDIO could not save the ticket change. Nothing was moved." as const;
export const POS_OPEN_TICKET_CANCEL_SUCCESS_MESSAGE = "Ticket cancelled." as const;

const openTicketCancelDeviceCredentialSchema = z.object({
  deviceId: z.uuid(),
  secret: z.string().regex(/^[0-9a-fA-F]{64}$/),
  appVersion: z.string().trim().min(1).max(80),
});

export const cancelOpenTicketSchema = z.object({
  ticketId: z.uuid(),
  device: openTicketCancelDeviceCredentialSchema.nullable().optional(),
});

export type CancelOpenTicketValues = z.infer<typeof cancelOpenTicketSchema>;

export type OpenTicketCancelResult =
  | { ok: true; message: string }
  | { ok: false; message: string };
