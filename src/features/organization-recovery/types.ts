export type RecoveryDrillType =
  | "EXPORT_REVIEW"
  | "LOCAL_RESTORE"
  | "SUPABASE_RESTORE_OR_CLONE";

export type RecoveryDrillOutcome = "PASSED" | "FAILED";

export type OrganizationRecoverySnapshot = {
  governance: {
    audit_retention_days: number;
    archived_data_retention_days: number;
    automatic_purge_enabled: boolean;
  };
  latest_delivered_export: {
    delivered_at: string;
    record_count: number;
    format: string;
  } | null;
  latest_recovery_drill: {
    drill_type: RecoveryDrillType;
    outcome: RecoveryDrillOutcome;
    recovery_point_at: string;
    duration_minutes: number;
    notes: string;
    recorded_at: string;
  } | null;
  archive_export_is_current: boolean;
};
