import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useSession } from "../src/features/session/session-provider";
export default function IndexScreen() { const { loading, accessMode } = useSession(); return loading ? <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator /></View> : <Redirect href={accessMode === "online" || accessMode === "offline" ? "/(app)" : "/sign-in"} />; }
