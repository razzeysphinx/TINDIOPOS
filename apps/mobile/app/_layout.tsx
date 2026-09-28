import "react-native-url-polyfill/auto";
import { Stack } from "expo-router";
import { SessionProvider } from "../src/features/session/session-provider";
export default function RootLayout() { return <SessionProvider><Stack screenOptions={{ headerShown: false }} /></SessionProvider>; }
