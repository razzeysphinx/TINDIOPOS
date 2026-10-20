import { z } from "zod";

import {
  posDeviceCredentialSchema,
} from "@/features/devices/device-schema";
import {
  openTicketCartLineSchema,
  saveOpenTicketSchema,
  type OpenTicketCartLineValues,
} from "@tindio/contracts/open-ticket-save";

export const ticketCartLineSchema = openTicketCartLineSchema;
export { saveOpenTicketSchema };

export const ticketReallocationLinesSchema =
  z.array(
    z.object({
      ticketLineId: z.uuid(),
      quantity:
        z.number()
          .min(0.001)
          .max(10_000)
          .refine(
            (value) =>
              Number.isInteger(
                value * 1_000,
              ),
          ),
    }),
  )
    .min(1)
    .max(100);

export const moveOpenTicketLinesSchema =
  z.object({
    sourceTicketId: z.uuid(),
    destinationTicketId: z.uuid(),
    lines:
      ticketReallocationLinesSchema,
    device:
      posDeviceCredentialSchema
        .nullable()
        .optional(),
  });

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

export const cancelOpenTicketSchema =
  z.object({
    ticketId: z.uuid(),
    device:
      posDeviceCredentialSchema
        .nullable()
        .optional(),
  });

export type TicketCartLineValues = OpenTicketCartLineValues;

export type TicketReallocationLines =
  z.infer<
    typeof ticketReallocationLinesSchema
  >;

export type {
  TicketActionResult,
  TicketMutationResult,
} from "@tindio/contracts";
