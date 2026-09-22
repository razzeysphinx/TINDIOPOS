import { z } from "zod";

import {
  posDeviceCredentialSchema,
} from "@/features/devices/device-schema";

export const ticketCartLineSchema =
  z.object({
    productId: z.uuid(),
    variantId: z.uuid().nullable(),
    quantity: z
      .number()
      .min(0.001)
      .max(10_000)
      .refine(
        (value) =>
          Number.isInteger(
            value * 1_000,
          ),
      ),
    modifierOptionIds:
      z.array(z.uuid()).max(50),
    productName:
      z.string().min(1).max(160),
    variantName:
      z.string().nullable(),
    sku:
      z.string().nullable(),
    barcode:
      z.string().nullable(),
    categoryId:
      z.uuid().nullable(),
    priceMinor:
      z.number().int().min(0),
    unit:
      z.string().min(1).max(24),
    imageUrl:
      z.url().nullable().optional(),
    isVariablePrice:
      z.boolean(),
    allowFractionalQuantity:
      z.boolean(),
    manualPriceMinor:
      z.number().int().positive().nullable(),
    ticketLineId:
      z.uuid().optional(),
    itemNote:
      z.string()
        .trim()
        .max(500)
        .nullable()
        .optional(),
    modifiers:
      z.array(
        z.object({
          id: z.uuid(),
          name:
            z.string().max(100),
          priceMinor:
            z.number()
              .int()
              .min(0),
        }),
      ).optional(),
  });

export const saveOpenTicketSchema =
  z.object({
    storeId: z.uuid(),
    registerId: z.uuid(),
    ticketId: z.uuid().nullable(),
    customerId: z.uuid().nullable(),
    diningOptionId:
      z.uuid().nullable(),
    assignedEmployeeId:
      z.uuid().nullable(),
    label:
      z.string()
        .trim()
        .min(1)
        .max(100),
    note:
      z.string()
        .trim()
        .max(500),
    cart:
      z.array(ticketCartLineSchema)
        .min(1)
        .max(100),
    device:
      posDeviceCredentialSchema
        .nullable()
        .optional(),
  });

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

export type TicketCartLineValues =
  z.infer<
    typeof ticketCartLineSchema
  >;

export type TicketReallocationLines =
  z.infer<
    typeof ticketReallocationLinesSchema
  >;

export type TicketActionResult =
  | {
      ok: true;
      ticketId: string;
      message: string;
    }
  | {
      ok: false;
      message: string;
    };

export type TicketMutationResult =
  | {
      ok: true;
      message: string;
    }
  | {
      ok: false;
      message: string;
    };
