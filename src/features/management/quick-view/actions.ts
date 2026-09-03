"use server";

import { z } from "zod";

import {
  loadManagementRegisterOperationalDrawer,
  loadManagementStoreDrawer,
} from "@/features/management/data";
import type {
  ManagementRegisterOperationalDrawerData,
  ManagementStoreDrawerData,
} from "@/features/management/management-types";
import { requireBackOfficePermission } from "@/lib/auth/dal";

const storeIdSchema = z.object({ storeId: z.uuid() });
const registerIdSchema = z.object({ registerId: z.uuid() });

export type ManagementStoreDrawerActionResult =
  | { ok: true; data: ManagementStoreDrawerData }
  | { ok: false; message: string };

/**
 * Authorization is server-side and capability-based. The loader also checks
 * the actual store scope so a caller cannot request a different store ID.
 */
export async function loadManagementStoreDrawerAction(
  input: unknown,
): Promise<ManagementStoreDrawerActionResult> {
  const parsed = storeIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "We couldn't load this store." };

  try {
    const context = await requireBackOfficePermission(["stores.manage", "registers.manage"]);
    const data = await loadManagementStoreDrawer(context, parsed.data.storeId);
    return data
      ? { ok: true, data }
      : { ok: false, message: "We couldn't load this store." };
  } catch {
    return { ok: false, message: "We couldn't load this store." };
  }
}

export type ManagementRegisterDrawerActionResult =
  | { ok: true; data: ManagementRegisterOperationalDrawerData }
  | { ok: false; message: string };

/**
 * This mirrors the Store Drawer gate and leaves authorization with the
 * server-side capability and store-scope layers, not the visible register
 * list. RLS is retained as database defense in depth.
 */
export async function loadManagementRegisterDrawerAction(
  input: unknown,
): Promise<ManagementRegisterDrawerActionResult> {
  const parsed = registerIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "We couldn't load this register." };

  try {
    const context = await requireBackOfficePermission(["stores.manage", "registers.manage"]);
    const data = await loadManagementRegisterOperationalDrawer(context, parsed.data.registerId);
    return data
      ? { ok: true, data }
      : { ok: false, message: "We couldn't load this register." };
  } catch {
    return { ok: false, message: "We couldn't load this register." };
  }
}
