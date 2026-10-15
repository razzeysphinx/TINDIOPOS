import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text } from "react-native";

import {
  getHistoricalAndroidExitEvents,
  isA45CertificationTriggerAvailable,
  triggerA45Anr,
  triggerA45NativeCrash,
  type AndroidExitEvent,
} from "../../modules/tindio-exit-observer";

export default function A45CertificationScreen() {
  const available = isA45CertificationTriggerAvailable();
  const [events, setEvents] = useState<AndroidExitEvent[]>([]);

  useEffect(() => {
    void getHistoricalAndroidExitEvents().then(setEvents);
  }, []);

  return (
    <ScrollView contentContainerStyle={{ gap: 18, padding: 24 }}>
      <Text style={{ fontSize: 28, fontWeight: "700" }}>A45 certification diagnostics</Text>
      <Text>
        {available
          ? "DEBUGGABLE TEST BUILD — synthetic native failure triggers enabled"
          : "Production-safe build — synthetic failure triggers disabled"}
      </Text>
      <Text>Only Android exit reason and timestamp are retained. No exception, stack, customer, payment, receipt, or transaction payload is collected.</Text>
      <Text>Historical actionable exits: {events.length}</Text>
      {events.map((event) => (
        <Text key={`${event.type}-${event.timestampMs}`}>
          {event.type} · {new Date(event.timestampMs).toISOString()}
        </Text>
      ))}
      {available ? (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={triggerA45NativeCrash}
            style={{ backgroundColor: "#991b1b", borderRadius: 10, padding: 16 }}
          >
            <Text style={{ color: "white", fontWeight: "700" }}>Trigger synthetic native crash</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={triggerA45Anr}
            style={{ backgroundColor: "#9a3412", borderRadius: 10, padding: 16 }}
          >
            <Text style={{ color: "white", fontWeight: "700" }}>Trigger synthetic Android ANR</Text>
          </Pressable>
        </>
      ) : null}
    </ScrollView>
  );
}
