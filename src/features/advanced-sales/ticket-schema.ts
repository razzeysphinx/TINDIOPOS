import { z } from "zod";

import {
  posDeviceCredentialSchema,
} from "@/features/devices/device-schema";
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

export const ticketCartLineSchema = openTicketCartLineSchema;
export {
  cancelOpenTicketSchema,
  moveOpenTicketLinesSchema,
  saveOpenTicketSchema,
  ticketReallocationLinesSchema,
};

export const splitOpenTicketSchema =
  z.object({
    sourceTicketId: z.uuid(),
    label:
      z.string()
        .trim()
        .min(1)
        .max(100),
    lines:
      ticketReallocationLinesSchema,
    device:
      posDeviceCredentialSchema
        .nullable()
        .optional(),
  });

export const mergeOpenTicketsSchema =
  z.object({
    sourceTicketId: z.uuid(),
    destinationTicketId: z.uuid(),
    device:
      posDeviceCredentialSchema
        .nullable()
        .optional(),
  });

export type TicketCartLineValues = OpenTicketCartLineValues;

export type { TicketReallocationLines };

export type {
  TicketActionResult,
  TicketMutationResult,
} from "@tindio/contracts";
