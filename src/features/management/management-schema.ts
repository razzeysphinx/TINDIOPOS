import { z } from "zod";

const upperCode = z
  .string()
  .trim()
  .min(2, "Use at least 2 characters.")
  .max(32, "Use at most 32 characters.")
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Use letters, numbers, _ or -.")
  .transform((value) => value.toUpperCase());

export const createStoreSchema = z.object({
  name: z.string().trim().min(2, "Enter a store name.").max(160),
  code: upperCode,
  address: z.string().trim().max(500),
  phone: z.string().trim().max(40),
});

export const createRegisterSchema = z.object({
  storeId: z.uuid("Select a store."),
  name: z.string().trim().min(2, "Enter a register name.").max(160),
  code: upperCode,
});

export const createRoleSchema = z.object({
  name: z.string().trim().min(2, "Enter a role name.").max(80),
  code: z
    .string()
    .trim()
    .min(2, "Use at least 2 characters.")
    .max(40)
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/, "Use letters, numbers, or _.")
    .transform((value) => value.toLowerCase()),
  description: z.string().trim().max(500),
  permissionCodes: z
    .array(z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/))
    .min(1, "Select at least one permission.")
    .max(100),
});

export const createInvitationSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Enter a valid email address.")
    .max(320)
    .transform((value) => value.toLowerCase()),
  employeeNumber: upperCode,
  jobTitle: z.string().trim().max(120),
  roleId: z.uuid("Select a role."),
  storeId: z.uuid("Select a store."),
});

export const invitationTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, "Invitation token is invalid.");

export const revokeInvitationSchema = z.object({
  invitationId: z.uuid(),
});

export const acceptPendingInvitationSchema = z.object({
  invitationId: z.uuid(),
});

export type CreateStoreValues = z.infer<typeof createStoreSchema>;
export type CreateRegisterValues = z.infer<typeof createRegisterSchema>;
export type CreateRoleValues = z.infer<typeof createRoleSchema>;
export type CreateInvitationValues = z.infer<typeof createInvitationSchema>;
