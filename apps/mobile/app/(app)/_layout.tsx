import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useSession } from "../../src/features/session/session-provider";
import { BusinessContextProvider } from "../../src/features/business/business-context-provider";
export default function AppLayout() { const { loading, accessMode } = useSession(); if (loading) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator /></View>; return accessMode === "online" || accessMode === "offline" ? <BusinessContextProvider><Stack screenOptions={{ headerShown: false }} /></BusinessContextProvider> : <Redirect href="/sign-in" />; }
