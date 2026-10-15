import { useEffect } from "react";
import { AppState } from "react-native";

import { recordProductionAnr } from "./production-crash-state";

const SAMPLE_INTERVAL_MS = 5_000;
const UNRESPONSIVE_THRESHOLD_MS = 15_000;

export function ProductionResponsivenessMonitor() {
  useEffect(() => {
    let active = AppState.currentState === "active";
    let expectedAt = Date.now() + SAMPLE_INTERVAL_MS;
    const subscription = AppState.addEventListener("change", (state) => {
      active = state === "active";
      expectedAt = Date.now() + SAMPLE_INTERVAL_MS;
    });
    const interval = setInterval(() => {
      const now = Date.now();
      const delay = now - expectedAt;
      expectedAt = now + SAMPLE_INTERVAL_MS;
      if (active && delay >= UNRESPONSIVE_THRESHOLD_MS) {
        void recordProductionAnr().catch(() => undefined);
      }
    }, SAMPLE_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, []);

  return null;
}
