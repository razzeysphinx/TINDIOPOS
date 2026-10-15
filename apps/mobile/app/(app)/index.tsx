import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { cashierFeatureGates } from "../../src/features/cashier/cashier-feature-gates";
import {
  buildCashierNavigation,
  type CashierNavigationSection,
} from "../../src/features/cashier/cashier-navigation";
import { useBusinessContext } from "../../src/features/business/use-business-context";
import { DeviceSetup } from "../../src/features/device/device-setup";
import {
  canReleaseTransactionCustody,
} from "../../src/features/offline/transaction-custody";
import { cashierReadinessLabel } from "../../src/features/offline/cashier-readiness-policy";
import { useSession } from "../../src/features/session/session-provider";

export default function MobileHomeScreen() {
  const { signOut } = useSession();

  const {
    data,
    loading,
    error,
    reload,
    mode,
    connectionMode,
    offlineExpiresAt,
    cashierReadinessState,
  } = useBusinessContext();

  const [message, setMessage] =
    useState<string | null>(null);

  if (loading && !data) {
    return (
      <View
        accessibilityLabel="Loading register"
        style={styles.centeredState}
      >
        <ActivityIndicator />
        <Text style={styles.stateDescription}>
          Opening this register…
        </Text>
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={styles.unavailableScreen}>
        <View style={styles.unavailableCard}>
          <Text style={styles.eyebrow}>
            TINDIO POS
          </Text>
          <Text
            accessibilityRole="header"
            style={styles.stateTitle}
          >
            We couldn’t open this register
          </Text>
          <Text
            accessibilityRole="alert"
            style={styles.readinessBadge}
          >
            {cashierReadinessLabel(cashierReadinessState)}
          </Text>
          <Text style={styles.stateDescription}>
            {error
              ?? "Business context is unavailable."}
          </Text>
          <Text style={styles.stateGuidance}>
            Check the connection, then try again. Saved transactions remain on this device.
          </Text>

          <Pressable
            accessibilityRole="button"
            onPress={() => void reload()}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
            ]}
          >
            <Text style={styles.primaryButtonLabel}>
              Try again
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const { core } = data;
  const gates = cashierFeatureGates(core);

  const navigation = buildCashierNavigation({
    gates,
    permissions: core.permissions,
  });

  const navigationSections: Array<{
    key: CashierNavigationSection;
    label: string;
  }> = [
    { key: "CHECKOUT", label: "Checkout" },
    { key: "OPERATIONS", label: "Store work" },
    { key: "SUPPORT", label: "Help and recovery" },
  ];

  const switchOrganization =
    async (organizationId: string) => {
      if (
        organizationId
        === core.organization.id
      ) {
        return;
      }

      const custody =
        await canReleaseTransactionCustody(
          core.organization.id,
        );

      if (!custody.ok) {
        setMessage(custody.message);
        return;
      }

      setMessage(null);
      await reload(organizationId);
    };

  const safeSignOut = async () => {
    const result = await signOut();

    if (!result.ok) {
      setMessage(result.message);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={{
        padding: 24,
        gap: 16,
      }}
    >
      <Text
        accessibilityRole="header"
        style={{ fontSize: 30, fontWeight: "800" }}
      >
        TINDIO POS
      </Text>
      <Text style={{ fontSize: 18, fontWeight: "600" }}>
        {core.organization.name}
      </Text>
      <Text
        accessibilityRole={cashierReadinessState === "READY_OFFLINE" ? undefined : "alert"}
      >
        Terminal readiness: {cashierReadinessLabel(cashierReadinessState)}
      </Text>
      {cashierReadinessState === "EXPIRING_SOON" ? (
        <Text accessibilityRole="alert">
          Offline authorization expires soon. Reconnect before {offlineExpiresAt ?? "the displayed deadline"} to keep accepting offline cash sales.
        </Text>
      ) : null}
      {cashierReadinessState === "EXPIRED_RECONNECT_REQUIRED" ? (
        <Text accessibilityRole="alert">
          Offline sales are paused. Reconnect and sign in; accepted receipts and pending transactions remain available for recovery.
        </Text>
      ) : null}
      <Text>
        {connectionMode === "CLOUD_ONLINE"
          ? "Connected to TINDIO"
          : "Working with saved store data"}
      </Text>

      {mode === "offline" ? (
        <View>
          <Text>
            {connectionMode === "STORE_LOCAL"
              ? "STORE LOCAL MODE"
              : connectionMode === "RECOVERING"
                ? "RECOVERING — CLOUD RETURNED, RECONCILIATION IN PROGRESS"
                : connectionMode === "SYNC_REVIEW"
                  ? "SYNC REVIEW REQUIRED"
                  : "DEVICE ISOLATED MODE"}
          </Text>
          <Text>
            Cloud validation unavailable.
          </Text>
          <Text>
            Offline authorization expires:{" "}
            {offlineExpiresAt ?? "unknown"}
          </Text>
        </View>
      ) : (
        <Text>Your latest store data is available.</Text>
      )}

      <Text>Signed in as {core.employee.name}</Text>
      <Text>
        Roles:{" "}
        {core.roleNames.join(", ")
          || "No role names"}
      </Text>

      {navigationSections.map((section) => {
        const items = navigation.filter(
          (item) => item.section === section.key,
        );

        if (items.length === 0) return null;

        return (
          <View key={section.key} style={{ gap: 10 }}>
            <Text
              accessibilityRole="header"
              style={{ fontSize: 18, fontWeight: "700" }}
            >
              {section.label}
            </Text>
            {items.map((item) => (
              <Pressable
                accessibilityHint={item.description}
                accessibilityLabel={item.label}
                accessibilityRole="button"
                key={item.path}
                onPress={() => router.push(item.path as never)}
                style={{
                  borderRadius: 12,
                  borderWidth: 1,
                  gap: 4,
                  justifyContent: "center",
                  minHeight: 64,
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                }}
              >
                <Text style={{ fontSize: 17, fontWeight: "700" }}>
                  {item.label}
                </Text>
                <Text>{item.description}</Text>
              </Pressable>
            ))}
          </View>
        );
      })}

      <Text>Assigned stores</Text>

      {core.stores.map((store) => (
        <Text key={store.id}>
          {store.name}
        </Text>
      ))}

      {mode === "online" ? (
        <>
          <Text>Organizations</Text>

          {core.availableOrganizations.map(
            (organization) => (
              <Pressable
                key={organization.id}
                onPress={() =>
                  void switchOrganization(
                    organization.id,
                  )
                }
              >
                <Text>{organization.name}</Text>
              </Pressable>
            ),
          )}

          <DeviceSetup
            core={core}
            onEnrolled={() => reload(core.organization.id)}
          />
        </>
      ) : null}

      <Text>
        {core.activeShift
          ? "Active shift found"
          : "No active shift"}
      </Text>

      {message ? <Text>{message}</Text> : null}

      <Pressable
        onPress={() => void safeSignOut()}
      >
        <Text>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centeredState: {
    alignItems: "center",
    flex: 1,
    gap: 12,
    justifyContent: "center",
    padding: 24,
  },
  eyebrow: {
    color: "#047857",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  primaryButton: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: "#047857",
    borderRadius: 12,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 20,
  },
  primaryButtonLabel: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "800",
  },
  primaryButtonPressed: {
    opacity: 0.82,
  },
  readinessBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#FEF3C7",
    borderRadius: 999,
    color: "#92400E",
    fontSize: 13,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  stateDescription: {
    color: "#374151",
    fontSize: 16,
    lineHeight: 24,
  },
  stateGuidance: {
    color: "#6B7280",
    fontSize: 14,
    lineHeight: 21,
  },
  stateTitle: {
    color: "#111827",
    fontSize: 26,
    fontWeight: "800",
    lineHeight: 32,
  },
  unavailableCard: {
    backgroundColor: "#FFFFFF",
    borderColor: "#D1D5DB",
    borderRadius: 20,
    borderWidth: 1,
    elevation: 2,
    gap: 16,
    maxWidth: 520,
    padding: 24,
    shadowColor: "#111827",
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    width: "100%",
  },
  unavailableScreen: {
    backgroundColor: "#F4EFE5",
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
});
