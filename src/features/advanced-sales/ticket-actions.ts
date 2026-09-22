"use server";

import { revalidatePath } from "next/cache";

import {
  cancelOpenTicket,
  mergeOpenTickets,
  moveOpenTicketLines,
  saveOpenTicket,
  splitOpenTicket,
  type TicketActionResult,
  type TicketMutationResult,
} from "@/features/advanced-sales/ticket-service";
import { requireBusinessContext } from "@/lib/auth/dal";

export type { TicketActionResult } from "@/features/advanced-sales/ticket-service";

function revalidateTickets() {
  revalidatePath("/pos");
}

export async function saveOpenTicketAction(input: unknown): Promise<TicketActionResult> {
  const context = await requireBusinessContext();
  const result = await saveOpenTicket({ context, input });
  if (result.ok) revalidateTickets();
  return result;
}

export async function cancelOpenTicketAction(input: unknown): Promise<TicketMutationResult> {
  const context = await requireBusinessContext();
  const result = await cancelOpenTicket({ context, input });
  if (result.ok) revalidateTickets();
  return result;
}

export async function moveOpenTicketLinesAction(input: unknown): Promise<TicketMutationResult> {
  const context = await requireBusinessContext();
  const result = await moveOpenTicketLines({ context, input });
  if (result.ok) revalidateTickets();
  return result;
}

export async function splitOpenTicketAction(input: unknown): Promise<TicketActionResult> {
  const context = await requireBusinessContext();
  const result = await splitOpenTicket({ context, input });
  if (result.ok) revalidateTickets();
  return result;
}

export async function mergeOpenTicketsAction(input: unknown): Promise<TicketMutationResult> {
  const context = await requireBusinessContext();
  const result = await mergeOpenTickets({ context, input });
  if (result.ok) revalidateTickets();
  return result;
}
