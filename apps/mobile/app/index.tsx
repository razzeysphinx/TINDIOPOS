import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useSession } from "../src/features/session/session-provider";
export default function IndexScreen() { const { session, loading } = useSession(); return loading ? <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator /></View> : <Redirect href={session ? "/(app)" : "/sign-in"} />; }
