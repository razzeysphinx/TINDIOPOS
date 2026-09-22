import "server-only";

import { z } from "zod";

import { posDeviceCredentialSchema, posDeviceRequestHeaders } from "@/features/devices/device-schema";
import { hasPermission, type BusinessContext } from "@/lib/auth/dal";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

const cartLineSchema = z.object({
  productId: z.uuid(),
  variantId: z.uuid().nullable(),
  quantity: z.number().min(0.001).max(10_000).refine((value) => Number.isInteger(value * 1_000)),
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

const saveSchema = z.object({
  storeId: z.uuid(),
  registerId: z.uuid(),
  ticketId: z.uuid().nullable(),
  customerId: z.uuid().nullable(),
  diningOptionId: z.uuid().nullable(),
  assignedEmployeeId: z.uuid().nullable(),
  label: z.string().trim().min(1).max(100),
  note: z.string().trim().max(500),
  cart: z.array(cartLineSchema).min(1).max(100),
  device: posDeviceCredentialSchema.nullable().optional(),
});

const ticketLinesSchema = z.array(z.object({
  ticketLineId: z.uuid(),
  quantity: z.number().min(0.001).max(10_000).refine((value) => Number.isInteger(value * 1_000)),
})).min(1).max(100);

const moveSchema = z.object({
  sourceTicketId: z.uuid(),
  destinationTicketId: z.uuid(),
  lines: ticketLinesSchema,
  device: posDeviceCredentialSchema.nullable().optional(),
});

const splitSchema = z.object({
  sourceTicketId: z.uuid(),
  label: z.string().trim().min(1).max(100),
  lines: ticketLinesSchema,
  device: posDeviceCredentialSchema.nullable().optional(),
});

const mergeSchema = z.object({
  sourceTicketId: z.uuid(),
  destinationTicketId: z.uuid(),
  device: posDeviceCredentialSchema.nullable().optional(),
});

const cancelSchema = z.object({
  ticketId: z.uuid(),
  device: posDeviceCredentialSchema.nullable().optional(),
});

export type TicketActionResult =
  | { ok: true; ticketId: string; message: string }
  | { ok: false; message: string };

export type TicketMutationResult = { ok: true; message: string } | { ok: false; message: string };

function databaseMessage(error: { code?: string; message?: string } | null) {
  if (error?.code === "42501" && error.message?.toLowerCase().includes("device")) return error.message;
  if (error?.code === "42501") return "You do not have permission to change these tickets.";
  if (error?.code === "23514" && error.message) return error.message;
  return "TINDIO could not save the ticket change. Nothing was moved.";
}

function hasTicketContext(context: BusinessContext) {
  return hasPermission(context, "pos.access")
    && hasPermission(context, "sales.create")
    && hasPermission(context, "tickets.manage")
    && context.features.open_tickets;
}

function ticketCart(lines: z.infer<typeof cartLineSchema>[]): Json {
  return lines.map((line) => ({
    product_id: line.productId,
    variant_id: line.variantId,
    quantity: line.quantity,
    unit_price_minor: line.manualPriceMinor,
    modifier_option_ids: line.modifierOptionIds,
    ticket_line_id: line.ticketLineId,
    item_note: line.itemNote || null,
    productName: line.productName,
    variantName: line.variantName,
    sku: line.sku,
    barcode: line.barcode,
    categoryId: line.categoryId,
    priceMinor: line.priceMinor,
    unit: line.unit,
    imageUrl: line.imageUrl ?? null,
    isVariablePrice: line.isVariablePrice,
    allowFractionalQuantity: line.allowFractionalQuantity,
    manualPriceMinor: line.manualPriceMinor,
    modifiers: line.modifiers ?? [],
  })) as Json;
}

function reallocationLines(lines: z.infer<typeof ticketLinesSchema>): Json {
  return lines.map((line) => ({
    ticket_line_id: line.ticketLineId,
    quantity: line.quantity,
  })) as Json;
}

export async function saveOpenTicket({ context, input }: { context: BusinessContext; input: unknown }): Promise<TicketActionResult> {
  const parsed = saveSchema.safeParse(input);
  if (!hasTicketContext(context) || !parsed.success || !context.storeIds.includes(parsed.data.storeId)) {
    return { ok: false, message: "Check the ticket details and your store access." };
  }

  const data = parsed.data;
  const supabase = await createClient({ headers: posDeviceRequestHeaders(data.device) });
  const { data: ticket, error } = await supabase.rpc("save_open_ticket_v2", {
    target_organization_id: context.organization.id,
    target_store_id: data.storeId,
    target_register_id: data.registerId,
    target_ticket_id: (data.ticketId ?? null) as never,
    target_customer_id: (data.customerId ?? null) as never,
    target_dining_option_id: (data.diningOptionId ?? null) as never,
    target_assigned_employee_id: (data.assignedEmployeeId ?? null) as never,
    target_label: data.label,
    target_note: data.note || null as never,
    target_cart: ticketCart(data.cart),
  });
  if (error || !ticket?.[0]) return { ok: false, message: databaseMessage(error) };
  return { ok: true, ticketId: ticket[0].ticket_id, message: "Ticket saved." };
}

export async function cancelOpenTicket({ context, input }: { context: BusinessContext; input: unknown }): Promise<TicketMutationResult> {
  const parsed = cancelSchema.safeParse(input);
  if (!hasTicketContext(context) || !parsed.success) return { ok: false, message: "This ticket is unavailable." };
  const database = await createClient({ headers: posDeviceRequestHeaders(parsed.data.device) }) as unknown as {
    rpc: (name: string, args: Record<string, string>) => Promise<{ error: { code?: string; message?: string } | null }>;
  };
  const { error } = await database.rpc("cancel_open_ticket", {
    target_organization_id: context.organization.id,
    target_ticket_id: parsed.data.ticketId,
  });
  if (error) return { ok: false, message: databaseMessage(error) };
  return { ok: true, message: "Ticket cancelled." };
}

export async function moveOpenTicketLines({ context, input }: { context: BusinessContext; input: unknown }): Promise<TicketMutationResult> {
  const parsed = moveSchema.safeParse(input);
  if (!hasTicketContext(context) || !parsed.success) return { ok: false, message: "Choose valid source, destination, and ticket lines." };
  const { error } = await (await createClient({ headers: posDeviceRequestHeaders(parsed.data.device) })).rpc("move_open_ticket_lines", {
    target_organization_id: context.organization.id,
    target_source_ticket_id: parsed.data.sourceTicketId,
    target_destination_ticket_id: parsed.data.destinationTicketId,
    target_lines: reallocationLines(parsed.data.lines),
  });
  if (error) return { ok: false, message: databaseMessage(error) };
  return { ok: true, message: "Selected items moved to the destination ticket." };
}

export async function splitOpenTicket({ context, input }: { context: BusinessContext; input: unknown }): Promise<TicketActionResult> {
  const parsed = splitSchema.safeParse(input);
  if (!hasTicketContext(context) || !parsed.success) return { ok: false, message: "Enter a name and choose valid ticket items." };
  const { data: ticketId, error } = await (await createClient({ headers: posDeviceRequestHeaders(parsed.data.device) })).rpc("split_open_ticket", {
    target_organization_id: context.organization.id,
    target_source_ticket_id: parsed.data.sourceTicketId,
    target_label: parsed.data.label,
    target_lines: reallocationLines(parsed.data.lines),
  });
  if (error || !ticketId) return { ok: false, message: databaseMessage(error) };
  return { ok: true, ticketId, message: "A new ticket was created from the selected items." };
}

export async function mergeOpenTickets({ context, input }: { context: BusinessContext; input: unknown }): Promise<TicketMutationResult> {
  const parsed = mergeSchema.safeParse(input);
  if (!hasTicketContext(context) || !parsed.success) return { ok: false, message: "Choose two different open tickets." };
  const { error } = await (await createClient({ headers: posDeviceRequestHeaders(parsed.data.device) })).rpc("merge_open_tickets", {
    target_organization_id: context.organization.id,
    target_source_ticket_id: parsed.data.sourceTicketId,
    target_destination_ticket_id: parsed.data.destinationTicketId,
  });
  if (error) return { ok: false, message: databaseMessage(error) };
  return { ok: true, message: "Tickets merged. The original source ticket remains in the audit history." };
}
