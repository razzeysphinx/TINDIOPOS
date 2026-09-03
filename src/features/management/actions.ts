"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  acceptPendingInvitationSchema,
  deleteUnusedSetupRecordSchema,
  invitationTokenSchema,
} from "@/features/management/management-schema";
import type { GuardedSetupRecordKind } from "@/features/management/guarded-delete-types";
import type { ManagementActionResult } from "@/features/management/management-types";
import { hashInvitationToken } from "@/features/management/invitation-token";
import {
  createEmployeeInvitation,
  createRegister,
  createRole,
  createStore,
  databaseMessage,
  revokeEmployeeInvitation,
  updateRegister,
  updateEmployeeAssignments,
  updateRole,
  updateStore,
  validationError,
} from "@/features/management/service";
import {
  getBusinessContext,
  hasPermission,
  requireBusinessContext,
  requireUser,
} from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export async function createStoreAction(
  input: unknown,
): Promise<ManagementActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "stores.manage")) {
    return { ok: false, message: "You do not have permission to create stores." };
  }

  const result = await createStore(context, input);

  if (result.ok) {
    revalidatePath("/back-office/stores");
    revalidatePath("/back-office/stores-registers");
    revalidatePath("/back-office");
  }

  return result;
}

export async function updateStoreAction(
  input: unknown,
): Promise<ManagementActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "stores.manage")) {
    return { ok: false, message: "You do not have permission to update stores." };
  }

  const result = await updateStore(context, input);

  if (result.ok) {
    revalidatePath("/back-office/stores");
    revalidatePath("/back-office/stores-registers");
    revalidatePath("/back-office/registers");
    revalidatePath("/back-office/employees");
    revalidatePath("/back-office");
  }

  return result;
}

export async function createRegisterAction(
  input: unknown,
): Promise<ManagementActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "registers.manage")) {
    return {
      ok: false,
      message: "You do not have permission to create registers.",
    };
  }

  const result = await createRegister(context, input);

  if (result.ok) {
    revalidatePath("/back-office/registers");
    revalidatePath("/back-office/stores-registers");
    revalidatePath("/back-office");
  }

  return result;
}

export async function updateRegisterAction(
  input: unknown,
): Promise<ManagementActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "registers.manage")) {
    return { ok: false, message: "You do not have permission to update registers." };
  }

  const result = await updateRegister(context, input);

  if (result.ok) {
    revalidatePath("/back-office/registers");
    revalidatePath("/back-office/stores-registers");
    revalidatePath("/back-office");
  }

  return result;
}

export async function createRoleAction(
  input: unknown,
): Promise<ManagementActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "roles.manage")) {
    return { ok: false, message: "You do not have permission to create roles." };
  }

  const result = await createRole(context, input);

  if (result.ok) {
    revalidatePath("/back-office/roles");
    revalidatePath("/back-office/employees");
    revalidatePath("/back-office");
  }

  return result;
}

export async function updateRoleAction(
  input: unknown,
): Promise<ManagementActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "roles.manage")) {
    return { ok: false, message: "You do not have permission to update roles." };
  }

  const result = await updateRole(context, input);

  if (result.ok) {
    revalidatePath("/back-office/roles");
    revalidatePath("/back-office/employees");
    revalidatePath("/back-office");
  }

  return result;
}

export async function updateEmployeeAssignmentsAction(
  input: unknown,
): Promise<ManagementActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "employees.manage")) {
    return { ok: false, message: "You do not have permission to update employees." };
  }

  const result = await updateEmployeeAssignments(context, input);

  if (result.ok) {
    revalidatePath("/back-office/employees");
    revalidatePath("/back-office/roles");
    revalidatePath("/back-office", "layout");
  }

  return result;
}

export async function createEmployeeInvitationAction(
  input: unknown,
): Promise<ManagementActionResult<{ inviteUrl: string }>> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "employees.manage")) {
    return {
      ok: false,
      message: "You do not have permission to invite employees.",
    };
  }

  const result = await createEmployeeInvitation(context, input);

  if (result.ok) {
    revalidatePath("/back-office/employees");
  }

  return result;
}

export async function revokeEmployeeInvitationAction(
  input: unknown,
): Promise<ManagementActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "employees.manage")) {
    return { ok: false, message: "You do not have permission to revoke invitations." };
  }

  const result = await revokeEmployeeInvitation(context, input);

  if (result.ok) {
    revalidatePath("/back-office/employees");
  }

  return result;
}

const deletePermissionByRecordType: Record<GuardedSetupRecordKind, string> = {
  category: "products.manage",
  custom_role: "roles.manage",
  payment_method: "settings.manage",
  discount: "products.manage",
  tax_rate: "products.manage",
  dining_option: "products.manage",
  ticket_template: "products.manage",
  modifier_group: "products.manage",
  supplier: "inventory.manage",
};

function revalidateDeletedSetupRecord(recordType: GuardedSetupRecordKind) {
  const pathsByRecordType: Record<GuardedSetupRecordKind, string[]> = {
    category: ["/back-office/categories", "/back-office/catalog", "/pos", "/kitchen"],
    custom_role: ["/back-office/roles", "/back-office/employees"],
    payment_method: ["/back-office/payment-methods", "/pos"],
    discount: ["/back-office/advanced-sales", "/pos"],
    tax_rate: ["/back-office/advanced-sales", "/pos"],
    dining_option: ["/back-office/advanced-sales", "/pos"],
    ticket_template: ["/back-office/advanced-sales"],
    modifier_group: ["/back-office/advanced-sales", "/pos"],
    supplier: ["/back-office/inventory"],
  };

  for (const path of pathsByRecordType[recordType]) revalidatePath(path);
  revalidatePath("/back-office");
}

export async function deleteUnusedSetupRecordAction(
  input: unknown,
): Promise<ManagementActionResult> {
  const context = await requireBusinessContext();
  const parsed = deleteUnusedSetupRecordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter the exact record name to confirm deletion." };

  if (!hasPermission(context, deletePermissionByRecordType[parsed.data.recordType] as never)) {
    return { ok: false, message: "You do not have permission to permanently delete this record." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_unused_setup_record", {
    target_organization_id: context.organization.id,
    target_record_type: parsed.data.recordType,
    target_record_id: parsed.data.recordId,
    target_confirmation_name: parsed.data.confirmationName,
  });

  if (error || !data) {
    if (error?.code === "42501") {
      return { ok: false, message: "You do not have permission to permanently delete this record." };
    }

    if (error?.code === "23503") {
      return { ok: false, message: "That record is no longer available in this organization." };
    }

    if (error?.code === "22023" || error?.code === "23514") {
      return { ok: false, message: error?.message ?? "This record cannot be permanently deleted." };
    }

    return { ok: false, message: "TINDIO could not permanently delete this record." };
  }

  revalidateDeletedSetupRecord(parsed.data.recordType);
  return { ok: true, message: `${data} was permanently deleted.` };
}

// Deferred from the management layer split: these four entry points are the
// accept-invitation flow (join/auth path). They validate and consume
// hashed invitation tokens via the controlled `accept_employee_invitation`
// RPC. Their implementations are intentionally left untouched.
export async function acceptEmployeeInvitationAction(
  input: unknown,
): Promise<ManagementActionResult<{ redirectTo: string }>> {
  await requireUser();

  if (await getBusinessContext()) {
    return { ok: false, message: "This account already belongs to an organization." };
  }

  const parsed = invitationTokenSchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_employee_invitation", {
    invitation_token_hash: hashInvitationToken(parsed.data),
  });

  if (error) {
    return {
      ok: false,
      message: databaseMessage(
        error.code,
        "The invitation is invalid, expired, or belongs to another email.",
      ),
    };
  }

  revalidatePath("/back-office", "layout");
  return {
    ok: true,
    message: "Invitation accepted.",
    data: { redirectTo: "/back-office" },
  };
}

export async function acceptEmployeeInvitationFormAction(
  _previousState: ManagementActionResult<{ redirectTo: string }> | null,
  formData: FormData,
): Promise<ManagementActionResult<{ redirectTo: string }> | null> {
  const result = await acceptEmployeeInvitationAction(formData.get("token"));

  if (!result.ok) {
    return result;
  }

  redirect(result.data?.redirectTo ?? "/back-office");
}

export async function acceptPendingEmployeeInvitationAction(
  input: unknown,
): Promise<ManagementActionResult<{ redirectTo: string }>> {
  const user = await requireUser();

  if (await getBusinessContext()) {
    return { ok: false, message: "This account already belongs to an organization." };
  }

  const parsed = acceptPendingInvitationSchema.safeParse(input);
  if (!parsed.success || !user.email) return validationError();

  const supabase = await createClient();
  const { data: invitation, error: invitationError } = await supabase
    .from("employee_invitations")
    .select("token_hash")
    .eq("id", parsed.data.invitationId)
    .eq("email", user.email.trim().toLowerCase())
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (invitationError || !invitation) {
    return {
      ok: false,
      message: "This invitation is no longer active or belongs to another email.",
    };
  }

  const { error } = await supabase.rpc("accept_employee_invitation", {
    invitation_token_hash: invitation.token_hash,
  });

  if (error) {
    return {
      ok: false,
      message: databaseMessage(
        error.code,
        "TINDIO could not attach the employee role. Ask your manager to recreate the invitation.",
      ),
    };
  }

  revalidatePath("/back-office", "layout");
  return {
    ok: true,
    message: "Invitation accepted.",
    data: { redirectTo: "/back-office" },
  };
}

export async function acceptPendingEmployeeInvitationFormAction(
  _previousState: ManagementActionResult<{ redirectTo: string }> | null,
  formData: FormData,
): Promise<ManagementActionResult<{ redirectTo: string }> | null> {
  const result = await acceptPendingEmployeeInvitationAction({
    invitationId: formData.get("invitationId"),
  });

  if (!result.ok) {
    return result;
  }

  redirect(result.data?.redirectTo ?? "/back-office");
}
