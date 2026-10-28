import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { cashierFeatureGates } from "../../src/features/cashier/cashier-feature-gates";
import { buildCashierNavigation, type CashierNavigationSection } from "../../src/features/cashier/cashier-navigation";
import { CashierReadinessPanel } from "../../src/features/cashier/cashier-readiness-panel";
import { CashierTaskCard } from "../../src/features/cashier/cashier-task-card";
import { CashierTerminalHeader } from "../../src/features/cashier/cashier-terminal-header";
import { useBusinessContext } from "../../src/features/business/use-business-context";
import { DeviceSetup } from "../../src/features/device/device-setup";
import { canReleaseTransactionCustody } from "../../src/features/offline/transaction-custody";
import { useSession } from "../../src/features/session/session-provider";
import { tindioTheme } from "../../src/ui/theme";
import { TindioButton } from "../../src/ui/tindio-button";
import { TindioCard } from "../../src/ui/tindio-card";
import { TindioFeedback } from "../../src/ui/tindio-feedback";
import { TindioScreen } from "../../src/ui/tindio-screen";
import { useTindioResponsiveLayout } from "../../src/ui/tindio-responsive";
import { TindioProgressIndicator } from "../../src/ui/tindio-progress-indicator";

const navigationSections: Array<{ key: CashierNavigationSection; label: string }> = [
  { key: "CHECKOUT", label: "Checkout" }, { key: "OPERATIONS", label: "Store work" }, { key: "SUPPORT", label: "Help and recovery" },
];

export default function MobileHomeScreen() {
  const { allowsColumns, allowsDenseGrid, viewportClass } = useTindioResponsiveLayout();
  const { signOut } = useSession();
  const { data, loading, error, reload, mode, connectionMode, offlineExpiresAt, cashierReadinessState } = useBusinessContext();
  const [message, setMessage] = useState<string | null>(null);

  if (loading && !data) return <View accessibilityLabel="Loading register" style={styles.centeredState}><TindioProgressIndicator color={tindioTheme.color.brand.primary} label="Opening this register" /></View>;

  if (!data) {
    return <TindioScreen contentContainerStyle={styles.unavailableScreen} edges={[]}><TindioCard style={styles.unavailableCard}><Text style={styles.eyebrow}>TINDIO POS</Text><Text accessibilityRole="header" style={styles.stateTitle}>We couldn’t open this register</Text><TindioFeedback description={error ?? "Business context is unavailable. Check the connection, then try again. Saved transactions remain on this device."} kind="error" title="Register unavailable" /><TindioButton accessibilityLabel="Try opening the register again" onPress={() => void reload()}>Try again</TindioButton></TindioCard></TindioScreen>;
  }

  const { core } = data;
  const navigation = buildCashierNavigation({ gates: cashierFeatureGates(core), permissions: core.permissions });
  const connectionLabel = connectionMode === "CLOUD_ONLINE" ? "Connected to TINDIO" : connectionMode === "STORE_LOCAL" ? "Using the store connection" : connectionMode === "RECOVERING" ? "Reconnecting saved work" : connectionMode === "SYNC_REVIEW" ? "Review required" : "Using saved store data";

  const switchOrganization = async (organizationId: string) => {
    if (organizationId === core.organization.id) return;
    const custody = await canReleaseTransactionCustody(core.organization.id);
    if (!custody.ok) { setMessage(custody.message); return; }
    setMessage(null);
    await reload(organizationId);
  };
  const safeSignOut = async () => { const result = await signOut(); if (!result.ok) setMessage(result.message); };

  return (
    <TindioScreen contentContainerStyle={[styles.screenContent, allowsColumns ? styles.screenContentTablet : null]} edges={[]} scroll testID="cashier-home-scroll">
      <CashierTerminalHeader connectionLabel={connectionLabel} employeeName={core.employee.name} organizationName={core.organization.name} readinessState={cashierReadinessState} />
      <CashierReadinessPanel expiresAt={offlineExpiresAt} state={cashierReadinessState} />
      {error ? <TindioFeedback description={error} kind="restriction" title="Update required" /> : null}
      <View accessibilityLabel={`${viewportClass} cashier workspace`} style={[styles.workspace, allowsColumns ? styles.workspaceTablet : null]}>
        <View style={styles.primaryColumn}>
          {navigationSections.map((section) => {
            const items = navigation.filter((item) => item.section === section.key);
            if (items.length === 0) return null;
            return <View key={section.key} style={styles.section}><Text accessibilityRole="header" style={styles.sectionTitle}>{section.label}</Text><View style={styles.taskGrid}>{items.map((item) => <CashierTaskCard description={item.description} key={item.path} label={item.label} onPress={() => router.push(item.path as never)} style={allowsDenseGrid ? styles.taskCardTablet : styles.taskCardPhone} />)}</View></View>;
          })}
        </View>
        <View style={styles.contextColumn}>
          <TindioCard description={core.activeShift ? "A shift is active on this register." : "Open a shift before starting work that requires one."} title="Register details"><Text style={styles.secondaryText}>Assigned stores</Text>{core.stores.map((store) => <Text key={store.id} style={styles.detailText}>{store.name}</Text>)}</TindioCard>
          {mode === "online" ? <TindioCard description="Changing businesses is blocked while this device holds unresolved transactions." title="Business">{core.availableOrganizations.map((organization) => <TindioButton key={organization.id} onPress={() => void switchOrganization(organization.id)} variant={organization.id === core.organization.id ? "secondary" : "ghost"}>{organization.name}</TindioButton>)}<DeviceSetup core={core} onEnrolled={() => reload(core.organization.id)} /></TindioCard> : null}
          {message ? <TindioFeedback description={message} kind="restriction" title="Action paused" /> : null}
          <TindioButton onPress={() => void safeSignOut()} variant="ghost">Sign out</TindioButton>
        </View>
      </View>
    </TindioScreen>
  );
}

const styles = StyleSheet.create({
  centeredState: { alignItems: "center", backgroundColor: tindioTheme.color.surface.app, flex: 1, gap: tindioTheme.space.sm, justifyContent: "center", padding: tindioTheme.space.lg },
  unavailableScreen: { alignItems: "center", justifyContent: "center" }, unavailableCard: { maxWidth: 520, width: "100%" },
  eyebrow: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.brand.primary, letterSpacing: 1.2 }, stateTitle: { ...tindioTheme.typography.role.title, color: tindioTheme.color.content.primary },
  screenContent: { alignSelf: "center", maxWidth: 1120, width: "100%" }, screenContentTablet: { padding: tindioTheme.space.lg },
  workspace: { gap: tindioTheme.space.lg }, workspaceTablet: { alignItems: "flex-start", flexDirection: "row" }, primaryColumn: { flex: 2, gap: tindioTheme.space.lg, minWidth: 0 }, contextColumn: { flex: 1, gap: tindioTheme.space.md, minWidth: 280 },
  section: { gap: tindioTheme.space.sm }, sectionTitle: { ...tindioTheme.typography.role.section, color: tindioTheme.color.content.primary }, taskGrid: { flexDirection: "row", flexWrap: "wrap", gap: tindioTheme.space.sm }, taskCardPhone: { width: "100%" }, taskCardTablet: { flexBasis: "47%", flexGrow: 1 },
  secondaryText: { ...tindioTheme.typography.role.body, color: tindioTheme.color.content.secondary }, detailText: { ...tindioTheme.typography.role.label, color: tindioTheme.color.content.primary },
});
