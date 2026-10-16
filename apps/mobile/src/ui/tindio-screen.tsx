import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { tindioTheme } from "./theme";

type TindioScreenProps = {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  edges?: Edge[];
  scroll?: boolean;
  testID?: string;
};

const defaultEdges: Edge[] = ["top", "right", "bottom", "left"];

export function TindioScreen({
  children,
  contentContainerStyle,
  edges = defaultEdges,
  scroll = false,
  testID,
}: TindioScreenProps) {
  return (
    <SafeAreaView edges={edges} style={styles.safeArea} testID={testID}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.content, contentContainerStyle]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, styles.fill, contentContainerStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: tindioTheme.color.surface.app, flex: 1 },
  content: { gap: tindioTheme.space.md, padding: tindioTheme.space.md },
  fill: { flex: 1 },
});
