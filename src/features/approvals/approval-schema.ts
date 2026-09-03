import { z } from "zod";

export const approvalOperationSchema = z.enum([
  "sales.refund",
  "cash.pay_out",
  "inventory.adjust",
]);

export const approvalPayloadSchema = z.object({}).catchall(z.unknown());

export const requestManagerApprovalSchema = z.object({
  operationCode: approvalOperationSchema,
  reason: z.string().trim().min(2, "Enter a reason.").max(500),
  payload: approvalPayloadSchema,
});

export const approveManagerApprovalSchema = z.object({
  approvalRequestId: z.uuid(),
  employeeNumber: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Enter a valid employee number.")
    .transform((value) => value.toUpperCase()),
  pin: z.string().regex(/^\d{6,12}$/, "Use a 6–12 digit PIN."),
});

export const decideManagerApprovalSchema = z.object({
  approvalRequestId: z.uuid(),
  decision: z.enum(["APPROVED", "REJECTED"]),
});

export const setEmployeePinSchema = z.object({
  employeeId: z.uuid(),
  pin: z.string().regex(/^\d{6,12}$/, "Use a 6–12 digit PIN."),
});

export const updateApprovalRuleSchema = z.object({
  operationCode: approvalOperationSchema,
  decision: z.enum(["ALLOWED", "DENIED", "APPROVAL_REQUIRED"]),
  amountThreshold: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || /^\d{1,10}(?:\.\d{1,2})?$/.test(value),
      "Enter an amount with up to two decimals.",
    ),
  isEnabled: z.boolean(),
});

export type ApprovalOperation = z.infer<typeof approvalOperationSchema>;
export type UpdateApprovalRuleValues = z.infer<typeof updateApprovalRuleSchema>;
