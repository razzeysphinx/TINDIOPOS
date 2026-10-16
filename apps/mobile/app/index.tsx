import { Redirect } from "expo-router";
import { View } from "react-native";
import { useSession } from "../src/features/session/session-provider";
import { TindioProgressIndicator } from "../src/ui/tindio-progress-indicator";
export default function IndexScreen() { const { loading, accessMode } = useSession(); return loading ? <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><TindioProgressIndicator label="Opening TINDIO POS" /></View> : <Redirect href={accessMode === "online" || accessMode === "offline" ? "/(app)" : "/sign-in"} />; }
