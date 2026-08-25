import "server-only";

import {
  createInvitationSchema,
  createRegisterSchema,
  createRoleSchema,
  createStoreSchema,
  revokeInvitationSchema,
} from "@/features/management/management-schema";
import type { ManagementActionResult } from "@/features/management/management-types";
import { createInvitationToken, hashInvitationToken } from "@/features/management/invitation-token";
import type { BusinessContext } from "@/lib/auth/dal";
import {
  PERMISSION_DENIED_MESSAGE,
  postgresCodeMessage,
  validationFailure,
} from "@/lib/server/db-errors";
import { getPublicEnvironment } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export function validationError() {
  return validationFailure();
}

const MANAGEMENT_DB_MESSAGES: Record<string, string> = {
  "23505": "That code, email, or employee number is already in use.",
  "42501": PERMISSION_DENIED_MESSAGE,
};

export function databaseMessage(code: string | undefined, fallback: string) {
  return postgresCodeMessage(code, fallback, MANAGEMENT_DB_MESSAGES);
}

export async function createStore(
  context: BusinessContext,
  input: unknown,
): Promise<ManagementActionResult> {
  const parsed = createStoreSchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();

  if (!context.features.multi_store) {
    const { data: existingStores, error: existingStoresError } = await supabase
      .from("stores")
      .select("id")
      .eq("organization_id", context.organization.id)
      .limit(1);

    if (existingStoresError) {
      return { ok: false, message: "TINDIO could not verify the current store setup." };
    }

    if ((existingStores ?? []).length > 0) {
      return {
        ok: false,
        message: "Multi-store is disabled for this business. Enable it in Business Profile before adding another store.",
      };
    }
  }

  const { error } = await supabase.from("stores").insert({
    organization_id: context.organization.id,
    name: parsed.data.name,
    code: parsed.data.code,
    address: parsed.data.address || null,
    phone: parsed.data.phone || null,
  });

  if (error) {
    return {
      ok: false,
      message: databaseMessage(error.code, "TINDIO could not create the store."),
    };
  }

  return { ok: true, message: "Store created." };
}

export async function createRegister(
  context: BusinessContext,
  input: unknown,
): Promise<ManagementActionResult> {
  const parsed = createRegisterSchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { error } = await supabase.from("registers").insert({
    organization_id: context.organization.id,
    store_id: parsed.data.storeId,
    name: parsed.data.name,
    code: parsed.data.code,
  });

  if (error) {
    return {
      ok: false,
      message: databaseMessage(error.code, "TINDIO could not create the register."),
    };
  }

  return { ok: true, message: "Register created." };
}

export async function createRole(
  context: BusinessContext,
  input: unknown,
): Promise<ManagementActionResult> {
  const parsed = createRoleSchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_custom_role", {
    target_organization_id: context.organization.id,
    role_name: parsed.data.name,
    role_code: parsed.data.code,
    role_description: parsed.data.description,
    permission_codes: parsed.data.permissionCodes,
  });

  if (error) {
    return {
      ok: false,
      message: databaseMessage(error.code, "TINDIO could not create the role."),
    };
  }

  return { ok: true, message: "Custom role created." };
}

export async function createEmployeeInvitation(
  context: BusinessContext,
  input: unknown,
): Promise<ManagementActionResult<{ inviteUrl: string }>> {
  const parsed = createInvitationSchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const [roleResult, rolePermissionsResult, storeResult, employeeNumberResult] =
    await Promise.all([
      supabase
        .from("roles")
        .select("id, name")
        .eq("id", parsed.data.roleId)
        .eq("organization_id", context.organization.id)
        .maybeSingle(),
      supabase
        .from("role_permissions")
        .select("permission_code")
        .eq("organization_id", context.organization.id)
        .eq("role_id", parsed.data.roleId),
      supabase
        .from("stores")
        .select("id, name")
        .eq("id", parsed.data.storeId)
        .eq("organization_id", context.organization.id)
        .eq("is_active", true)
        .maybeSingle(),
      supabase
        .from("employees")
        .select("id")
        .eq("organization_id", context.organization.id)
        .eq("employee_number", parsed.data.employeeNumber)
        .maybeSingle(),
    ]);

  const lookupError = [
    roleResult,
    rolePermissionsResult,
    storeResult,
    employeeNumberResult,
  ].find((result) => result.error)?.error;

  if (lookupError) {
    return { ok: false, message: "TINDIO could not validate the invitation." };
  }

  if (!roleResult.data || !storeResult.data) {
    return { ok: false, message: "Select an active store and valid role." };
  }

  if (employeeNumberResult.data) {
    return { ok: false, message: "That employee number is already in use." };
  }

  const requestedPermissions = (rolePermissionsResult.data ?? []).map(
    (permission) => permission.permission_code,
  );
  if (requestedPermissions.some((permission) => !context.permissions.includes(permission))) {
    return {
      ok: false,
      message: "You cannot grant a role containing permissions you do not hold.",
    };
  }

  const token = createInvitationToken();
  const tokenHash = hashInvitationToken(token);
  const { error } = await supabase.from("employee_invitations").insert({
    organization_id: context.organization.id,
    organization_name_snapshot: context.organization.name,
    email: parsed.data.email,
    employee_number: parsed.data.employeeNumber,
    job_title: parsed.data.jobTitle || null,
    role_id: parsed.data.roleId,
    role_name_snapshot: roleResult.data.name,
    store_id: parsed.data.storeId,
    store_name_snapshot: storeResult.data.name,
    token_hash: tokenHash,
    invited_by: context.employee.id,
  });

  if (error) {
    return {
      ok: false,
      message: databaseMessage(error.code, "TINDIO could not create the invitation."),
    };
  }

  const { NEXT_PUBLIC_APP_URL } = getPublicEnvironment();
  const inviteQuery = new URLSearchParams({
    token,
    email: parsed.data.email,
  });
  const inviteUrl = `${NEXT_PUBLIC_APP_URL}/join?${inviteQuery.toString()}`;

  return {
    ok: true,
    message: "Invitation created. Copy this link now; TINDIO stores only its hash.",
    data: { inviteUrl },
  };
}

export async function revokeEmployeeInvitation(
  context: BusinessContext,
  input: unknown,
): Promise<ManagementActionResult> {
  const parsed = revokeInvitationSchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employee_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", parsed.data.invitationId)
    .eq("organization_id", context.organization.id)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return { ok: false, message: "The invitation could not be revoked." };
  }

  return { ok: true, message: "Invitation revoked." };
}
