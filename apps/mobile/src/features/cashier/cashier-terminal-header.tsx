import { StyleSheet, Text, View } from "react-native";

import { TindioStatusBadge } from "../../ui/tindio-status-badge";
import { tindioTheme } from "../../ui/theme";
import { useTindioResponsiveLayout } from "../../ui/tindio-responsive";
import type { CashierReadinessState } from "../offline/cashier-readiness-policy";
import { cashierReadinessLabel } from "../offline/cashier-readiness-policy";

type CashierTerminalHeaderProps = {
  connectionLabel: string;
  employeeName: string;
  organizationName: string;
  readinessState: CashierReadinessState;
};

const readinessTone = {
  READY_OFFLINE: "success",
  EXPIRING_SOON: "warning",
  EXPIRED_RECONNECT_REQUIRED: "danger",
  PREPARATION_REQUIRED: "warning",
  RECOVERING: "recovering",
  SYNC_REVIEW: "review",
} as const;

export function CashierTerminalHeader({ connectionLabel, employeeName, organizationName, readinessState }: CashierTerminalHeaderProps) {
  const { isLargeText, viewportClass } = useTindioResponsiveLayout();
  const stacked = isLargeText || viewportClass === "compact-phone";

  return (
    <View style={[styles.header, stacked ? styles.headerStacked : null]}>
      <View style={styles.identity}>
        <Text style={styles.eyebrow}>TINDIO POS</Text>
        <Text accessibilityRole="header" style={styles.organization}>{organizationName}</Text>
        <Text style={styles.employee}>Register operated by {employeeName}</Text>
      </View>
      <View style={[styles.statuses, stacked ? styles.statusesStacked : null]}>
        <TindioStatusBadge label={cashierReadinessLabel(readinessState)} tone={readinessTone[readinessState]} />
        <Text style={styles.connection}>{connectionLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: tindioTheme.color.brand.ink, borderRadius: tindioTheme.radius.lg, flexDirection: "row", flexWrap: "wrap", gap: tindioTheme.space.md, justifyContent: "space-between", padding: tindioTheme.space.lg },
  headerStacked: { flexDirection: "column", padding: tindioTheme.space.md },
  identity: { flex: 1, gap: tindioTheme.space.xxs, minWidth: 220 },
  eyebrow: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.brand.cream, letterSpacing: 1.4 },
  organization: { ...tindioTheme.typography.role.title, color: tindioTheme.color.content.inverse },
  employee: { ...tindioTheme.typography.role.body, color: "#C8D3CF" },
  statuses: { alignItems: "flex-end", gap: tindioTheme.space.xs },
  statusesStacked: { alignItems: "flex-start" },
  connection: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.brand.cream },
});
