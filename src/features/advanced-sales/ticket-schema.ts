import {
  openTicketCartLineSchema,
  saveOpenTicketSchema,
  type OpenTicketCartLineValues,
} from "@tindio/contracts/open-ticket-save";
import { cancelOpenTicketSchema } from "@tindio/contracts/open-ticket-cancel";
import {
  moveOpenTicketLinesSchema,
  ticketReallocationLinesSchema,
  type TicketReallocationLines,
} from "@tindio/contracts/open-ticket-move-lines";
import { splitOpenTicketSchema } from "@tindio/contracts/open-ticket-split";
import { mergeOpenTicketsSchema } from "@tindio/contracts/open-ticket-merge";

export const ticketCartLineSchema = openTicketCartLineSchema;
export {
  cancelOpenTicketSchema,
  moveOpenTicketLinesSchema,
  mergeOpenTicketsSchema,
  saveOpenTicketSchema,
  splitOpenTicketSchema,
  ticketReallocationLinesSchema,
};

export type TicketCartLineValues = OpenTicketCartLineValues;

export type { TicketReallocationLines };

export type {
  TicketActionResult,
  TicketMutationResult,
} from "@tindio/contracts";
