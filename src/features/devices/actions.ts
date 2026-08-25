"use server";

import { revalidatePath } from "next/cache";

import {
  changePosDeviceRegisterSchema,
  registerPosDeviceSchema,
  revokePosDeviceSchema,
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

export async function revokePosDeviceAction(input: unknown): Promise<DeviceActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "devices.manage")) {
    return { ok: false, message: "You do not have permission to revoke POS devices." };
  }

  const parsed = revokePosDeviceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "This POS device is invalid." };
  }

  const database = await createClient() as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
  };
  const { error } = await database.rpc("revoke_pos_device", {
    target_organization_id: context.organization.id,
    target_device_id: parsed.data.deviceId,
    target_reason: parsed.data.reason || null,
  });

  if (error) {
    return { ok: false, message: databaseMessage(error, "TINDIO could not revoke this device.") };
  }

  revalidateDeviceViews();
  return { ok: true, message: "The device was revoked and can no longer use its register." };
}
