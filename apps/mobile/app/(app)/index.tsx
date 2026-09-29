import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { cashierFeatureGates } from "../../src/features/cashier/cashier-feature-gates";
import { useBusinessContext } from "../../src/features/business/use-business-context";
import { DeviceSetup } from "../../src/features/device/device-setup";
import {
  canReleaseTransactionCustody,
} from "../../src/features/offline/transaction-custody";
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
  } = useBusinessContext();

  const [message, setMessage] =
    useState<string | null>(null);

  if (loading && !data) {
    return (
      <View>
        <ActivityIndicator />
      </View>
    );
  }

  if (error || !data) {
    return (
      <View>
        <Text>
          {error
            ?? "Business context is unavailable."}
        </Text>

        <Pressable
          onPress={() => void reload()}
        >
          <Text>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const { core } = data;
  const gates = cashierFeatureGates(core);

  const routes = [
    "/pos",
    ...(gates.receipts ? ["/receipts"] : []),
    ...(gates.customers ? ["/customers"] : []),
    ...(gates.shift ? ["/shift"] : []),
    "/sync-status",
    "/hardware",
    "/settings",
    ...(gates.tickets ? ["/tickets"] : []),
    ...(gates.transfers ? ["/transfers"] : []),
    ...(gates.timeClock ? ["/time-clock"] : []),
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
      <Text>
        Connection mode: {connectionMode}
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
        <Text>Backend V1 connected</Text>
      )}

      <Text>{core.organization.name}</Text>
      <Text>{core.employee.name}</Text>
      <Text>
        Roles:{" "}
        {core.roleNames.join(", ")
          || "No role names"}
      </Text>

      {routes.map((path) => (
        <Pressable
          key={path}
          onPress={() =>
            router.push(path as never)
          }
        >
          <Text>{path.slice(1)}</Text>
        </Pressable>
      ))}

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

          <DeviceSetup core={core} />
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
