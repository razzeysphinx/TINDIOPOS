import { z } from "zod";

export const POS_OPEN_TICKET_SAVE_PATH = "/api/pos/v2/tickets/save" as const;
export const POS_OPEN_TICKET_SAVE_RPC = "save_open_ticket_v2" as const;
export const POS_OPEN_TICKET_SAVE_PERMISSIONS = [
  "pos.access",
  "sales.create",
  "tickets.manage",
] as const;
export const POS_OPEN_TICKET_SAVE_FEATURE = "open_tickets" as const;
export const POS_OPEN_TICKET_SAVE_PERMISSION_DATABASE_CODE = "42501" as const;
export const POS_OPEN_TICKET_SAVE_CONSTRAINT_DATABASE_CODE = "23514" as const;

export const POS_OPEN_TICKET_SAVE_REQUEST_INVALID_MESSAGE =
  "The request data is invalid." as const;
export const POS_OPEN_TICKET_SAVE_INPUT_MESSAGE =
  "Check the ticket details and your store access." as const;
export const POS_OPEN_TICKET_SAVE_PERMISSION_MESSAGE =
  "You do not have permission to change these tickets." as const;
export const POS_OPEN_TICKET_SAVE_DATABASE_MESSAGE =
  "TINDIO could not save the ticket change. Nothing was moved." as const;
export const POS_OPEN_TICKET_SAVE_SUCCESS_MESSAGE = "Ticket saved." as const;

export const openTicketCartLineSchema = z.object({
  productId: z.uuid(),
  variantId: z.uuid().nullable(),
  quantity: z.number().min(0.001).max(10_000).refine(
    (value) => Number.isInteger(value * 1_000),
  ),
  modifierOptionIds: z.array(z.uuid()).max(50),
  productName: z.string().min(1).max(160),
  variantName: z.string().nullable(),
  sku: z.string().nullable(),
  barcode: z.string().nullable(),
  categoryId: z.uuid().nullable(),
  priceMinor: z.number().int().min(0),
  unit: z.string().min(1).max(24),
  imageUrl: z.url().nullable().optional(),
  isVariablePrice: z.boolean(),
  allowFractionalQuantity: z.boolean(),
  manualPriceMinor: z.number().int().positive().nullable(),
  ticketLineId: z.uuid().optional(),
  itemNote: z.string().trim().max(500).nullable().optional(),
  modifiers: z.array(z.object({
    id: z.uuid(),
    name: z.string().max(100),
    priceMinor: z.number().int().min(0),
  })).optional(),
});

const openTicketDeviceCredentialSchema = z.object({
  deviceId: z.uuid(),
  secret: z.string().regex(/^[0-9a-fA-F]{64}$/),
  appVersion: z.string().trim().min(1).max(80),
});

export const saveOpenTicketSchema = z.object({
  storeId: z.uuid(),
  registerId: z.uuid(),
  ticketId: z.uuid().nullable(),
  customerId: z.uuid().nullable(),
  diningOptionId: z.uuid().nullable(),
  assignedEmployeeId: z.uuid().nullable(),
  label: z.string().trim().min(1).max(100),
  note: z.string().trim().max(500),
  cart: z.array(openTicketCartLineSchema).min(1).max(100),
  device: openTicketDeviceCredentialSchema.nullable().optional(),
});

export type OpenTicketCartLineValues = z.infer<typeof openTicketCartLineSchema>;
export type SaveOpenTicketValues = z.infer<typeof saveOpenTicketSchema>;

export type OpenTicketSaveResult =
  | { ok: true; ticketId: string; message: string }
  | { ok: false; message: string };
