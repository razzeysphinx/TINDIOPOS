import { z } from "zod";

export const POS_OPEN_TICKET_MOVE_LINES_PATH =
  "/api/pos/v2/tickets/move-lines" as const;
export const POS_OPEN_TICKET_MOVE_LINES_RPC = "move_open_ticket_lines" as const;
export const POS_OPEN_TICKET_MOVE_LINES_PERMISSIONS = [
  "pos.access",
  "sales.create",
  "tickets.manage",
] as const;
export const POS_OPEN_TICKET_MOVE_LINES_FEATURE = "open_tickets" as const;
export const POS_OPEN_TICKET_MOVE_LINES_PERMISSION_DATABASE_CODE = "42501" as const;
export const POS_OPEN_TICKET_MOVE_LINES_CONSTRAINT_DATABASE_CODE = "23514" as const;
export const POS_OPEN_TICKET_MOVE_LINES_NOT_FOUND_DATABASE_CODE = "P0002" as const;

export const POS_OPEN_TICKET_MOVE_LINES_REQUEST_INVALID_MESSAGE =
  "The request data is invalid." as const;
export const POS_OPEN_TICKET_MOVE_LINES_INPUT_MESSAGE =
  "Choose valid source, destination, and ticket lines." as const;
export const POS_OPEN_TICKET_MOVE_LINES_PERMISSION_MESSAGE =
  "You do not have permission to change these tickets." as const;
export const POS_OPEN_TICKET_MOVE_LINES_DATABASE_MESSAGE =
  "TINDIO could not save the ticket change. Nothing was moved." as const;
export const POS_OPEN_TICKET_MOVE_LINES_SUCCESS_MESSAGE =
  "Selected items moved to the destination ticket." as const;

const openTicketMoveLinesDeviceCredentialSchema = z.object({
  deviceId: z.uuid(),
  secret: z.string().regex(/^[0-9a-fA-F]{64}$/),
  appVersion: z.string().trim().min(1).max(80),
});

export const ticketReallocationLinesSchema = z.array(
  z.object({
    ticketLineId: z.uuid(),
    quantity: z.number().min(0.001).max(10_000).refine(
      (value) => Number.isInteger(value * 1_000),
    ),
  }),
).min(1).max(100);

export const moveOpenTicketLinesSchema = z.object({
  sourceTicketId: z.uuid(),
  destinationTicketId: z.uuid(),
  lines: ticketReallocationLinesSchema,
  device: openTicketMoveLinesDeviceCredentialSchema.nullable().optional(),
});

export type TicketReallocationLines = z.infer<typeof ticketReallocationLinesSchema>;
export type MoveOpenTicketLinesValues = z.infer<typeof moveOpenTicketLinesSchema>;

export type OpenTicketMoveLinesResult =
  | { ok: true; message: string }
  | { ok: false; message: string };
