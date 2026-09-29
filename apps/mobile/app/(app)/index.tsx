import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { DeviceSetup } from "../../src/features/device/device-setup";
import { useBusinessContext } from "../../src/features/business/use-business-context";
import { useSession } from "../../src/features/session/session-provider";
import { cashierFeatureGates } from "../../src/features/cashier/cashier-feature-gates";

export default function MobileHomeScreen() {
  const { signOut } = useSession();
  const { data, loading, error, reload, mode, offlineExpiresAt } = useBusinessContext();
  if (loading && !data) return <View><ActivityIndicator /></View>;
  if (error || !data) return <View><Text>{error ?? "Business context is unavailable."}</Text><Pressable onPress={() => void reload()}><Text>Retry</Text></Pressable></View>;
  const { core } = data;
  return <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
    {mode === "offline" ? <View><Text>COLD-START OFFLINE MODE</Text><Text>Cloud validation unavailable.</Text><Text>Offline authorization expires: {offlineExpiresAt ?? "unknown"}</Text></View> : <Text>Backend V1 connected</Text>}
    <Text>{core.organization.name}</Text><Text>{core.employee.name}</Text><Text>Roles: {core.roleNames.join(", ") || "No role names"}</Text>
    {["/pos", "/receipts", "/customers", "/shift", "/sync-status", "/settings", ...(cashierFeatureGates(core).tickets ? ["/tickets"] : []), ...(cashierFeatureGates(core).transfers ? ["/transfers"] : []), ...(cashierFeatureGates(core).timeClock ? ["/time-clock"] : [])].map((path) => <Pressable key={path} onPress={() => router.push(path as never)}><Text>{path.slice(1)}</Text></Pressable>)}
    <Text>Assigned stores</Text>{core.stores.map((store) => <Text key={store.id}>{store.name}</Text>)}
    {mode === "online" ? <><Text>Organizations</Text>{core.availableOrganizations.map((organization) => <Pressable key={organization.id} onPress={() => void reload(organization.id)}><Text>{organization.name}</Text></Pressable>)}<DeviceSetup core={core} /></> : null}
    <Text>{core.activeShift ? "Active shift found" : "No active shift"}</Text><Pressable onPress={() => void signOut()}><Text>Sign out</Text></Pressable>
  </ScrollView>;
}
