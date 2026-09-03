"use server";

import { revalidatePath } from "next/cache";

import {
  adjustCustomerLoyaltyPoints,
  addLoyaltyCardStamp,
  claimLoyaltyCardReward,
  createCustomer,
  createCustomerSegment,
  importCustomersCsv,
  issueLoyaltyCard,
  revokeLoyaltyCard,
  rotateLoyaltyCardQr,
  updateCustomerProfile,
  updateCustomerStatus,
  updateCustomerSegment,
  updateLoyaltyProgram,
} from "@/features/customers/service";
import type { CustomerActionResult, LoyaltyCardCredential } from "@/features/customers/customer-types";
import type { PosCustomer } from "@/features/pos/pos-types";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";

export async function createCustomerAction(input: unknown): Promise<CustomerActionResult<PosCustomer>> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "customers.manage")) {
    return { ok: false, message: "You do not have permission to manage customers." };
  }

  const result = await createCustomer({ context, input });
  if (result.ok) {
    revalidatePath("/back-office/customers");
    revalidatePath("/pos");
  }

  return result;
}

export async function importCustomersCsvAction(input: unknown): Promise<CustomerActionResult<{ importedCount: number }>> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "customers.manage")) return { ok: false, message: "You do not have permission to import customers." };
  const result = await importCustomersCsv({ context, input });
  if (result.ok) {
    revalidatePath("/back-office/customers");
    revalidatePath("/pos");
  }
  return result;
}

export async function createCustomerSegmentAction(input: unknown): Promise<CustomerActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "customers.manage")) {
    return { ok: false, message: "You do not have permission to manage customer segments." };
  }

  const result = await createCustomerSegment({ context, input });
  if (result.ok) {
    revalidatePath("/back-office/customers");
  }

  return result;
}

export async function updateCustomerSegmentAction(input: unknown): Promise<CustomerActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "customers.manage")) {
    return { ok: false, message: "You do not have permission to manage customer segments." };
  }

  const result = await updateCustomerSegment({ context, input });
  if (result.ok) revalidatePath("/back-office/customers");
  return result;
}

export async function updateCustomerProfileAction(input: unknown): Promise<CustomerActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "customers.manage")) {
    return { ok: false, message: "You do not have permission to manage customers." };
  }

  const result = await updateCustomerProfile({ context, input });
  if (result.ok) {
    const { customerId } = input as { customerId: string };
    revalidatePath("/back-office/customers");
    revalidatePath(`/back-office/customers/${customerId}`);
    revalidatePath("/pos");
  }

  return result;
}

export async function adjustCustomerLoyaltyPointsAction(input: unknown): Promise<CustomerActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "customers.manage")) {
    return { ok: false, message: "You do not have permission to adjust loyalty points." };
  }

  const result = await adjustCustomerLoyaltyPoints({ context, input });
  if (result.ok) {
    const { customerId } = input as { customerId: string };
    revalidatePath("/back-office/customers");
    revalidatePath(`/back-office/customers/${customerId}`);
    revalidatePath("/pos");
  }

  return result;
}

function revalidateCustomerLoyaltyCardPaths(customerId?: string) {
  revalidatePath("/back-office/customers");
  if (customerId) revalidatePath(`/back-office/customers/${customerId}`);
}

export async function issueLoyaltyCardAction(input: unknown): Promise<CustomerActionResult<LoyaltyCardCredential>> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "customers.manage")) {
    return { ok: false, message: "You do not have permission to issue QR loyalty cards." };
  }

  const result = await issueLoyaltyCard({ context, input });
  if (result.ok) revalidateCustomerLoyaltyCardPaths((input as { customerId: string }).customerId);
  return result;
}

export async function rotateLoyaltyCardQrAction(input: unknown): Promise<CustomerActionResult<LoyaltyCardCredential>> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "customers.manage")) {
    return { ok: false, message: "You do not have permission to rotate QR loyalty cards." };
  }

  const result = await rotateLoyaltyCardQr({ context, input });
  if (result.ok) revalidateCustomerLoyaltyCardPaths((input as { customerId: string }).customerId);
  return result;
}

export async function revokeLoyaltyCardAction(input: unknown): Promise<CustomerActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "customers.manage")) {
    return { ok: false, message: "You do not have permission to revoke QR loyalty cards." };
  }

  const result = await revokeLoyaltyCard({ context, input });
  if (result.ok) revalidateCustomerLoyaltyCardPaths((input as { customerId: string }).customerId);
  return result;
}

export async function addLoyaltyCardStampAction(input: unknown): Promise<CustomerActionResult<{ stampCount: number; stampTarget: number; wasReplayed: boolean }>> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "customers.manage") && !hasPermission(context, "sales.create")) {
    return { ok: false, message: "You do not have permission to add QR loyalty stamps." };
  }

  const result = await addLoyaltyCardStamp({ context, input });
  if (result.ok) revalidateCustomerLoyaltyCardPaths((input as { customerId?: string }).customerId);
  return result;
}

export async function claimLoyaltyCardRewardAction(input: unknown): Promise<CustomerActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "customers.manage") && !hasPermission(context, "sales.create")) {
    return { ok: false, message: "You do not have permission to claim QR loyalty rewards." };
  }

  const result = await claimLoyaltyCardReward({ context, input });
  if (result.ok) revalidateCustomerLoyaltyCardPaths((input as { customerId?: string }).customerId);
  return result;
}

export async function updateCustomerStatusAction(input: unknown): Promise<CustomerActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "customers.manage")) {
    return { ok: false, message: "You do not have permission to manage customers." };
  }

  const result = await updateCustomerStatus({ context, input });
  if (result.ok) {
    const { customerId } = input as { customerId: string };
    revalidatePath("/back-office/customers");
    revalidatePath(`/back-office/customers/${customerId}`);
  }

  return result;
}

export async function updateLoyaltyProgramAction(input: unknown): Promise<CustomerActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "settings.manage")) {
    return { ok: false, message: "You do not have permission to change loyalty settings." };
  }

  const result = await updateLoyaltyProgram({ context, input });
  if (result.ok) {
    revalidatePath("/back-office/customers");
    revalidatePath("/pos");
  }

  return result;
}
