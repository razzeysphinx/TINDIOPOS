import { Linking, Pressable, Text, View } from "react-native";
import { useState } from "react";

import { mobileEnvironment } from "../../lib/env";

const links = [
  { label: "Privacy policy", path: "/privacy" },
  { label: "Support", path: "/support" },
  { label: "Delete account", path: "/account-deletion" },
] as const;

export function PublicPolicyLinks() {
  const [error, setError] = useState<string | null>(null);

  const open = async (path: string) => {
    try {
      setError(null);
      const url = new URL(path, `${mobileEnvironment.tindioApiUrl}/`).toString();
      await Linking.openURL(url);
    } catch {
      setError("This public page could not be opened. Check the connection and try again.");
    }
  };

  return (
    <View accessible accessibilityLabel="Privacy and support links" style={{ gap: 10 }}>
      <Text>Privacy and support</Text>
      {links.map((link) => (
        <Pressable accessibilityRole="link" key={link.path} onPress={() => void open(link.path)}>
          <Text>{link.label}</Text>
        </Pressable>
      ))}
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}
