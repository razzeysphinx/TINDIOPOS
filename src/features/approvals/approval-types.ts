export type ApprovalPreparationResult =
  | {
      ok: true;
      decision: "ALLOWED";
      message: string;
      data: { approvalRequestId: null; expiresAt: null };
    }
  | {
      ok: true;
      decision: "APPROVAL_REQUIRED";
      message: string;
      data: { approvalRequestId: string; expiresAt: string };
    }
  | { ok: false; decision: "DENIED"; message: string };

export type ApprovalActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export type ApprovalRuleDbRow = {
  operation_code: string;
  decision: string;
  amount_threshold_minor: number | null;
  is_enabled: boolean;
};

export type ApprovalRequestDbRow = {
  id: string;
  operation_code: string;
  status: string;
  requested_amount_minor: number | null;
  reason: string;
  requested_by_employee_id: string;
  approved_by_employee_id: string | null;
  requested_at: string;
  decided_at: string | null;
  expires_at: string;
};

export type ApprovalAuditLogRow = {
  id: string;
  event_type: string;
  operation_code: string | null;
  amount_minor: number | null;
  reason: string | null;
  actor_employee_id: string | null;
  created_at: string;
};

export type ApprovalEmployeeNumberRow = {
  id: string;
  employee_number: string;
};

export type SecurityOverview = {
  rules: ApprovalRuleDbRow[];
  requests: ApprovalRequestDbRow[];
  auditEntries: ApprovalAuditLogRow[];
  employees: ApprovalEmployeeNumberRow[];
};
