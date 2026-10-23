import { z } from "zod";
import { approvalOperationSchema } from "@tindio/contracts/approval-control";

export {
  approvalOperationSchema,
  approvalPayloadSchema,
  approveManagerApprovalSchema,
  requestManagerApprovalSchema,
} from "@tindio/contracts/approval-control";

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
