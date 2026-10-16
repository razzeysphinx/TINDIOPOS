import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AccessibilityInfo } from "react-native";

type TindioAccessibilityPreferences = {
  reduceMotionEnabled: boolean;
  screenReaderEnabled: boolean;
};

const defaultPreferences: TindioAccessibilityPreferences = {
  reduceMotionEnabled: false,
  screenReaderEnabled: false,
};

const TindioAccessibilityContext = createContext<TindioAccessibilityPreferences>(defaultPreferences);

export function TindioAccessibilityProvider({ children }: { children: ReactNode }) {
  const [reduceMotionEnabled, setReduceMotionEnabled] = useState(false);
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotionEnabled(enabled);
    });
    void AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
      if (active) setScreenReaderEnabled(enabled);
    });

    const reduceMotionSubscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotionEnabled,
    );
    const screenReaderSubscription = AccessibilityInfo.addEventListener(
      "screenReaderChanged",
      setScreenReaderEnabled,
    );

    return () => {
      active = false;
      reduceMotionSubscription.remove();
      screenReaderSubscription.remove();
    };
  }, []);

  const value = useMemo(
    () => ({ reduceMotionEnabled, screenReaderEnabled }),
    [reduceMotionEnabled, screenReaderEnabled],
  );

  return (
    <TindioAccessibilityContext.Provider value={value}>
      {children}
    </TindioAccessibilityContext.Provider>
  );
}

export function useTindioAccessibilityPreferences() {
  return useContext(TindioAccessibilityContext);
}
