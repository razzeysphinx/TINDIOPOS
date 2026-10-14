"use server";

import { revalidatePath } from "next/cache";

import {
  changePosDeviceRegisterSchema,
  registerPosDeviceSchema,
  retirePosDeviceSchema,
} from "@/features/devices/device-schema";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export type DeviceActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

function revalidateDeviceViews() {
  revalidatePath("/back-office/devices");
  revalidatePath("/pos");
  revalidatePath("/back-office/security");
}

function databaseMessage(error: { code?: string; message?: string } | null, fallback: string) {
  if ((error?.code === "23514" || error?.code === "P0002") && error.message) return error.message;
  if (error?.code === "23505") return "This browser is already registered as a TINDIO POS device.";
  if (error?.code === "42501") return "You do not have permission to manage TINDIO devices.";
  return fallback;
}

export async function registerPosDeviceAction(input: unknown): Promise<DeviceActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "devices.manage")) {
    return { ok: false, message: "You do not have permission to register POS devices." };
  }

  const parsed = registerPosDeviceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Choose a register and enter a valid device name." };
  }

  const supabase = await createClient();
  const database = supabase as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
  };
  const { error } = await database.rpc("register_pos_device", {
    target_organization_id: context.organization.id,
    target_store_id: parsed.data.storeId,
    target_register_id: parsed.data.registerId,
    target_device_id: parsed.data.deviceId,
    target_name: parsed.data.name,
    target_app_version: parsed.data.appVersion,
    target_secret: parsed.data.secret,
  });

  if (error) {
    return { ok: false, message: databaseMessage(error, "TINDIO could not register this device.") };
  }

  revalidateDeviceViews();
  return { ok: true, message: "This browser is now registered and bound to the selected register." };
}

export async function changePosDeviceRegisterAction(input: unknown): Promise<DeviceActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "devices.manage")) {
    return { ok: false, message: "You do not have permission to rebind POS devices." };
  }

  const parsed = changePosDeviceRegisterSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Choose a valid active store and register." };
  }

  const database = await createClient() as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
  };
  const { error } = await database.rpc("change_pos_device_register", {
    target_organization_id: context.organization.id,
    target_device_id: parsed.data.deviceId,
    target_store_id: parsed.data.storeId,
    target_register_id: parsed.data.registerId,
  });

  if (error) {
    return { ok: false, message: databaseMessage(error, "TINDIO could not change this device binding.") };
  }

  revalidateDeviceViews();
  return { ok: true, message: "The device is now bound to the selected register." };
}

export async function retirePosDeviceAction(input: unknown): Promise<DeviceActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "devices.manage")) {
    return { ok: false, message: "You do not have permission to revoke POS devices." };
  }

  const parsed = retirePosDeviceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Choose a custody decision, enter a specific reason, and complete the required confirmation." };
  }

  const database = await createClient() as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
  };
  const { data, error } = await database.rpc("retire_pos_device", {
    target_organization_id: context.organization.id,
    target_device_id: parsed.data.deviceId,
    target_custody_decision: parsed.data.custodyDecision,
    target_reason: parsed.data.reason,
    target_loss_confirmation: parsed.data.lossConfirmation || null,
  });

  if (error) {
    return { ok: false, message: databaseMessage(error, "TINDIO could not retire this device.") };
  }

  revalidateDeviceViews();
  const retirement = Array.isArray(data) ? data[0] as { custody_decision?: string; lost_custody_count?: number } | undefined : undefined;
  return retirement?.custody_decision === "DEVICE_UNAVAILABLE_ACCEPT_BOUNDED_LOSS"
    ? { ok: true, message: `The unavailable device was disabled. ${retirement.lost_custody_count ?? 0} active custody record(s) were preserved as LOST for audit and drawer review.` }
    : { ok: true, message: "The reconciled device was disabled and can no longer use its register." };
}
