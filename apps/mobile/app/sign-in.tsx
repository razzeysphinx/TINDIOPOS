import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  cashierReadinessLabel,
  deriveCashierReadinessState,
} from "../src/features/offline/cashier-readiness-policy";
import { useSession } from "../src/features/session/session-provider";
import { PublicPolicyLinks } from "../src/features/support/public-policy-links";

export default function SignInScreen() {
  const { signIn, offlineRestrictionReason, offlineAuthorizationState } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readinessState = deriveCashierReadinessState({
    connectionMode: "DEVICE_ISOLATED",
    authorizationState: offlineAuthorizationState,
  });

  const submit = async () => {
    if (pending || !email.trim() || !password) return;
    setPending(true);
    setError(null);
    const result = await signIn(email, password);
    setPending(false);
    if (!result.ok) return setError(result.message);
    router.replace("/(app)");
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1 }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{
            flexGrow: 1,
            gap: 14,
            justifyContent: "center",
            padding: 24,
            paddingBottom: 48,
          }}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          testID="sign-in-scroll"
        >
          <Text accessibilityRole="header" style={{ fontSize: 30, fontWeight: "800" }}>
            TINDIO POS
          </Text>
          <Text>Sign in with your TINDIO employee account.</Text>
          <Text accessibilityRole={readinessState === "READY_OFFLINE" ? undefined : "alert"}>
            Terminal readiness: {cashierReadinessLabel(readinessState)}
          </Text>
          {offlineRestrictionReason ? (
            <Text accessibilityRole="alert">{offlineRestrictionReason}</Text>
          ) : null}
          <TextInput
            accessibilityLabel="Employee email"
            autoCapitalize="none"
            autoComplete="email"
            editable={!pending}
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="Email"
            returnKeyType="next"
            style={{ minHeight: 48 }}
            value={email}
          />
          <TextInput
            accessibilityLabel="Employee password"
            autoCapitalize="none"
            editable={!pending}
            onChangeText={setPassword}
            onSubmitEditing={() => void submit()}
            placeholder="Password"
            returnKeyType="done"
            secureTextEntry
            style={{ minHeight: 48 }}
            value={password}
          />
          {error ? (
            <Text accessibilityLiveRegion="polite" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <Pressable
            accessibilityLabel="Sign in"
            accessibilityRole="button"
            disabled={pending}
            onPress={() => void submit()}
            style={{ minHeight: 48, justifyContent: "center" }}
          >
            <Text>{pending ? "Signing in…" : "Sign in"}</Text>
            {pending ? <ActivityIndicator /> : null}
          </Pressable>
          <PublicPolicyLinks />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
