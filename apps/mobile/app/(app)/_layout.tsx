import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useSession } from "../../src/features/session/session-provider";
export default function AppLayout() { const { session, loading } = useSession(); if (loading) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator /></View>; return session ? <Stack screenOptions={{ headerShown: false }} /> : <Redirect href="/sign-in" />; }
