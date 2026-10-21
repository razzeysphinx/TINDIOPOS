import { z } from "zod";

export const POS_OPEN_TICKET_SPLIT_PATH = "/api/pos/v2/tickets/split" as const;
export const POS_OPEN_TICKET_SPLIT_RPC = "split_open_ticket" as const;
export const POS_OPEN_TICKET_SPLIT_PERMISSIONS = [
  "pos.access",
  "sales.create",
  "tickets.manage",
] as const;
export const POS_OPEN_TICKET_SPLIT_FEATURE = "open_tickets" as const;
export const POS_OPEN_TICKET_SPLIT_PERMISSION_DATABASE_CODE = "42501" as const;
export const POS_OPEN_TICKET_SPLIT_CONSTRAINT_DATABASE_CODE = "23514" as const;
export const POS_OPEN_TICKET_SPLIT_NOT_FOUND_DATABASE_CODE = "P0002" as const;

export const POS_OPEN_TICKET_SPLIT_REQUEST_INVALID_MESSAGE =
  "The request data is invalid." as const;
export const POS_OPEN_TICKET_SPLIT_INPUT_MESSAGE =
  "Enter a name and choose valid ticket items." as const;
export const POS_OPEN_TICKET_SPLIT_PERMISSION_MESSAGE =
  "You do not have permission to change these tickets." as const;
export const POS_OPEN_TICKET_SPLIT_DATABASE_MESSAGE =
  "TINDIO could not save the ticket change. Nothing was moved." as const;
export const POS_OPEN_TICKET_SPLIT_SUCCESS_MESSAGE =
  "A new ticket was created from the selected items." as const;

const openTicketSplitDeviceCredentialSchema = z.object({
  deviceId: z.uuid(),
  secret: z.string().regex(/^[0-9a-fA-F]{64}$/),
  appVersion: z.string().trim().min(1).max(80),
});

export const splitTicketReallocationLinesSchema = z.array(
  z.object({
    ticketLineId: z.uuid(),
    quantity: z.number().min(0.001).max(10_000).refine(
      (value) => Number.isInteger(value * 1_000),
    ),
  }),
).min(1).max(100);

export const splitOpenTicketSchema = z.object({
  sourceTicketId: z.uuid(),
  label: z.string().trim().min(1).max(100),
  lines: splitTicketReallocationLinesSchema,
  device: openTicketSplitDeviceCredentialSchema.nullable().optional(),
});

export type SplitOpenTicketValues = z.infer<typeof splitOpenTicketSchema>;

export type OpenTicketSplitResult =
  | { ok: true; ticketId: string; message: string }
  | { ok: false; message: string };
